use rusqlite::types::Value as SqlValue;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const SCHEMA_VERSION: i64 = 3;
const ENTITY_MANIFEST: &str =
    include_str!("../../../../packages/sync-protocol/src/entity-manifest.json");
static ENTITY_TYPES: OnceLock<HashSet<String>> = OnceLock::new();

fn entity_type_supported(value: &str) -> bool {
    ENTITY_TYPES
        .get_or_init(|| {
            serde_json::from_str::<Value>(ENTITY_MANIFEST)
                .expect("checked-in sync entity manifest must be valid JSON")["entities"]
                .as_object()
                .expect("sync entity manifest must contain entities")
                .keys()
                .cloned()
                .collect()
        })
        .contains(value)
}
const MERGE_BATCH_SIZE: usize = 200;
const LIST_QUERY_CHUNK_SIZE: usize = 400;

#[derive(Debug)]
pub enum StorageError {
    Invalid(String),
    UnknownOperation,
    Sql(rusqlite::Error),
    Io(std::io::Error),
    Json(serde_json::Error),
}

impl From<rusqlite::Error> for StorageError {
    fn from(value: rusqlite::Error) -> Self {
        Self::Sql(value)
    }
}
impl From<std::io::Error> for StorageError {
    fn from(value: std::io::Error) -> Self {
        Self::Io(value)
    }
}
impl From<serde_json::Error> for StorageError {
    fn from(value: serde_json::Error) -> Self {
        Self::Json(value)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BlobDescriptor {
    pub hash: String,
    pub content_type: String,
    pub size: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryReport {
    pub stale_temps_removed: usize,
    pub missing_blobs_marked: usize,
    pub orphan_blobs_removed: usize,
    pub invalid_pending_removed: usize,
}

pub struct Storage {
    connection: Mutex<Connection>,
    root: PathBuf,
}

impl Storage {
    pub fn open(root: impl AsRef<Path>) -> Result<Self, StorageError> {
        let root = root.as_ref().to_path_buf();
        fs::create_dir_all(root.join("blobs"))?;
        fs::create_dir_all(root.join("tmp"))?;
        let connection = Connection::open(root.join("contextboard.sqlite3"))?;
        connection.pragma_update(None, "journal_mode", "WAL")?;
        connection.pragma_update(None, "foreign_keys", "ON")?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        migrate(&connection)?;
        let storage = Self {
            connection: Mutex::new(connection),
            root,
        };
        storage.recover()?;
        Ok(storage)
    }

    pub fn query(&self, workspace: &str, request: &Value) -> Result<Value, StorageError> {
        validate_id(workspace, "workspaceId")?;
        let operation = operation(request)?;
        let (entity_type, mode) =
            query_operation(operation).ok_or(StorageError::UnknownOperation)?;
        let input = match request.get("input") {
            None | Some(Value::Null) => None,
            Some(Value::Object(input)) => Some(input),
            Some(_) => {
                return Err(StorageError::Invalid(
                    "Query input must be an object".into(),
                ))
            }
        };
        let connection = self.connection.lock().expect("storage mutex poisoned");
        if mode == "get" {
            let id = input
                .and_then(|v| v.get("id"))
                .and_then(Value::as_str)
                .ok_or_else(|| StorageError::Invalid("A valid entity ID is required".into()))?;
            validate_id(id, "entityId")?;
            let value: Option<String> = connection.query_row(
                "SELECT value_json FROM entities WHERE workspace_id=?1 AND entity_type=?2 AND entity_id=?3 AND deleted=0",
                params![workspace, entity_type, id], |row| row.get(0),
            ).optional()?;
            return value
                .map(|v| serde_json::from_str(&v))
                .transpose()
                .map(|v| v.unwrap_or(Value::Null))
                .map_err(Into::into);
        }
        Ok(Value::Array(query_entity_list(
            &connection,
            workspace,
            entity_type,
            input,
        )?))
    }

    pub fn execute(&self, workspace: &str, request: &Value) -> Result<Value, StorageError> {
        validate_id(workspace, "workspaceId")?;
        let operation_name = operation(request)?;
        validate_operation_label(operation_name)?;
        let input = request
            .get("input")
            .and_then(Value::as_object)
            .ok_or_else(|| StorageError::Invalid("Command input must be an object".into()))?;
        let legacy = !input.contains_key("writes");
        let writes: Vec<(String, String, String, Option<Value>, Option<i64>)> =
            if let Some(values) = input.get("writes") {
                let values = values
                    .as_array()
                    .ok_or_else(|| StorageError::Invalid("writes must be an array".into()))?;
                if values.is_empty() {
                    return Err(StorageError::Invalid(
                        "writes must contain at least 1 entry".into(),
                    ));
                }
                values
                    .iter()
                    .map(|write| {
                        let object = write.as_object().ok_or_else(|| {
                            StorageError::Invalid("Each write must be an object".into())
                        })?;
                        let entity = object
                            .get("entity")
                            .and_then(Value::as_str)
                            .ok_or_else(|| StorageError::Invalid("Invalid entity type".into()))?;
                        if !entity_type_supported(entity) {
                            return Err(StorageError::Invalid("Invalid entity type".into()));
                        }
                        let action =
                            object
                                .get("operation")
                                .and_then(Value::as_str)
                                .ok_or_else(|| {
                                    StorageError::Invalid("Invalid write operation".into())
                                })?;
                        if action != "upsert" && action != "delete" {
                            return Err(StorageError::Invalid("Invalid write operation".into()));
                        }
                        let id = object.get("id").and_then(Value::as_str).ok_or_else(|| {
                            StorageError::Invalid("A valid entity ID is required".into())
                        })?;
                        validate_id(id, "entityId")?;
                        let value = object.get("value").cloned();
                        if action == "upsert" && value.is_none() {
                            return Err(StorageError::Invalid("Upserts require a value".into()));
                        }
                        if action == "delete" && value.is_some() {
                            return Err(StorageError::Invalid(
                                "Deletes cannot include a value".into(),
                            ));
                        }
                        let expected = object
                            .get("expectedRevision")
                            .map(|revision| {
                                revision.as_i64().ok_or_else(|| {
                                    StorageError::Invalid(
                                        "expectedRevision must be an integer".into(),
                                    )
                                })
                            })
                            .transpose()?;
                        Ok((
                            entity.to_owned(),
                            action.to_owned(),
                            id.to_owned(),
                            value,
                            expected,
                        ))
                    })
                    .collect::<Result<Vec<_>, StorageError>>()?
            } else {
                let (entity, action) =
                    command_operation(operation_name).ok_or(StorageError::UnknownOperation)?;
                let value = input
                    .get("value")
                    .unwrap_or(&Value::Object(input.clone()))
                    .clone();
                let id = value
                    .get("id")
                    .or_else(|| input.get("id"))
                    .and_then(Value::as_str)
                    .ok_or_else(|| StorageError::Invalid("A valid entity ID is required".into()))?
                    .to_owned();
                validate_id(&id, "entityId")?;
                vec![(entity.to_owned(), action.to_owned(), id, Some(value), None)]
            };
        let mut unique = std::collections::HashSet::new();
        for (entity, _, id, _, _) in &writes {
            if !unique.insert((entity.as_str(), id.as_str())) {
                return Err(StorageError::Invalid(
                    "A command cannot write the same entity twice".into(),
                ));
            }
        }
        let mut connection = self.connection.lock().expect("storage mutex poisoned");
        let transaction = connection.transaction()?;
        ensure_workspace(&transaction, workspace)?;
        let clock = tick_hlc(&transaction, workspace)?;
        let now = now_ms();
        let mut changes = Vec::with_capacity(writes.len());
        let mut materialized_values = Vec::with_capacity(writes.len());
        for (entity_type, action, id, value, expected_revision) in &writes {
            let existing: Option<(i64, String)> = transaction.query_row(
                "SELECT revision, value_json FROM entities WHERE workspace_id=?1 AND entity_type=?2 AND entity_id=?3",
                params![workspace, entity_type, id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            ).optional()?;
            if expected_revision
                .is_some_and(|expected| expected != existing.as_ref().map_or(0, |row| row.0))
            {
                return Err(StorageError::Invalid(format!(
                    "CONFLICT: revision mismatch for {entity_type}:{id}"
                )));
            }
            let revision = existing.as_ref().map_or(1, |value| value.0 + 1);
            let deleted = action == "delete";
            let mut materialized = if let Some(value) = value.clone() {
                value
            } else if let Some((_, existing_value)) = existing.as_ref() {
                serde_json::from_str(existing_value)?
            } else {
                json!({})
            };
            if let Some(object) = materialized.as_object_mut() {
                object.insert("id".into(), json!(id));
                object.insert("revision".into(), json!(revision));
                object.insert("updatedAt".into(), json!(now));
                object.insert(
                    "deletedAt".into(),
                    if deleted { json!(now) } else { Value::Null },
                );
            }
            transaction.execute(
                "INSERT INTO entities(workspace_id,entity_type,entity_id,value_json,revision,clock,deleted)
                 VALUES(?1,?2,?3,?4,?5,?6,?7)
                 ON CONFLICT(workspace_id,entity_type,entity_id) DO UPDATE SET
                 value_json=excluded.value_json, revision=excluded.revision, clock=excluded.clock, deleted=excluded.deleted",
                params![workspace, entity_type, id, serde_json::to_string(&materialized)?, revision, clock, deleted],
            )?;
            changes.push(json!({
                "entityType": entity_type, "entityId": id, "baseRevision": existing.as_ref().map(|row| row.0),
                "revision": revision,
                "operation": if deleted { "delete" } else { "upsert" },
                "clock": clock,
                "value": materialized
            }));
            materialized_values.push(materialized);
        }
        let sequence = next_sequence(&transaction, workspace)?;
        let change_id = Uuid::new_v4().to_string();
        let batch = json!({
            "protocolVersion": 1, "schemaVersion": 2, "changeId": change_id,
            "workspaceId": workspace, "deviceId": device_id(&transaction, workspace)?,
            "deviceSequence": sequence, "clock": clock, "command": operation_name,
            "createdAt": now, "changes": changes
        });
        transaction.execute(
            "INSERT INTO pending_batches(workspace_id,change_id,created_at,batch_json,valid) VALUES(?1,?2,?3,?4,1)",
            params![workspace, change_id, now, serde_json::to_string(&batch)?],
        )?;
        transaction.execute(
            "INSERT INTO applied_batches(workspace_id,change_id) VALUES(?1,?2)",
            params![workspace, change_id],
        )?;
        transaction.commit()?;
        Ok(if legacy && operation_name.ends_with(".create") {
            json!(writes[0].2)
        } else if legacy {
            materialized_values
                .into_iter()
                .next()
                .unwrap_or(Value::Null)
        } else {
            Value::Array(materialized_values)
        })
    }

    pub fn pending(&self, workspace: &str, limit: u32) -> Result<Value, StorageError> {
        validate_id(workspace, "workspaceId")?;
        if !(1..=1000).contains(&limit) {
            return Err(StorageError::Invalid(
                "limit must be between 1 and 1000".into(),
            ));
        }
        let connection = self.connection.lock().expect("storage mutex poisoned");
        let mut statement = connection.prepare(
            "SELECT batch_json FROM pending_batches WHERE workspace_id=?1 AND valid=1 ORDER BY created_at, change_id LIMIT ?2"
        )?;
        let rows = statement.query_map(params![workspace, limit], |row| row.get::<_, String>(0))?;
        Ok(Value::Array(
            rows.map(|row| serde_json::from_str(&row?).map_err(StorageError::from))
                .collect::<Result<Vec<_>, _>>()?,
        ))
    }

    pub fn acknowledge(&self, workspace: &str, ids: &[String]) -> Result<(), StorageError> {
        validate_id(workspace, "workspaceId")?;
        let mut connection = self.connection.lock().expect("storage mutex poisoned");
        let transaction = connection.transaction()?;
        for id in ids {
            validate_id(id, "changeId")?;
            transaction.execute(
                "DELETE FROM pending_batches WHERE workspace_id=?1 AND change_id=?2",
                params![workspace, id],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn apply_remote(
        &self,
        workspace: &str,
        batches: &Value,
        peer: &str,
        cursor: &str,
    ) -> Result<Value, StorageError> {
        validate_id(workspace, "workspaceId")?;
        validate_id(peer, "peerId")?;
        validate_cursor(cursor)?;
        let batches = batches
            .as_array()
            .ok_or_else(|| StorageError::Invalid("batches must be an array".into()))?;
        let mut connection = self.connection.lock().expect("storage mutex poisoned");
        let transaction = connection.transaction()?;
        ensure_workspace(&transaction, workspace)?;
        let mut applied = 0;
        let mut conflicts = 0;
        let mut materialized_changes = Vec::<Value>::new();
        for batch in batches {
            validate_batch(batch, workspace)?;
            let change_id = batch["changeId"].as_str().unwrap();
            let duplicate: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM applied_batches WHERE workspace_id=?1 AND change_id=?2)",
                params![workspace, change_id], |row| row.get(0),
            )?;
            if duplicate {
                continue;
            }
            let mut conflict_copy_by_card_id = HashMap::<String, String>::new();
            for change in batch["changes"].as_array().unwrap() {
                let entity_type = change["entityType"].as_str().unwrap();
                let entity_id = change["entityId"].as_str().unwrap();
                let incoming_clock = change["clock"].as_str().unwrap();
                let mut materialized = change["value"].clone();
                normalize_remote_value(entity_type, incoming_clock, &mut materialized);
                let target_entity_id = if entity_type == "cardContent" {
                    conflict_copy_by_card_id
                        .get(entity_id)
                        .cloned()
                        .unwrap_or_else(|| entity_id.to_owned())
                } else {
                    entity_id.to_owned()
                };
                if target_entity_id != entity_id {
                    if let Some(object) = materialized.as_object_mut() {
                        object.insert("id".into(), json!(target_entity_id));
                        object.insert("cardId".into(), json!(target_entity_id));
                    }
                }
                let local =
                    read_stored_entity(&transaction, workspace, entity_type, &target_entity_id)?;
                if entity_type == "whiteboard"
                    && invalid_remote_hierarchy(
                        &transaction,
                        workspace,
                        entity_id,
                        materialized
                            .get("parentWhiteboardId")
                            .and_then(Value::as_str),
                    )?
                {
                    let parent = materialized
                        .get("parentWhiteboardId")
                        .and_then(Value::as_str)
                        .unwrap_or("root");
                    let conflict_id = format!("hierarchy:{entity_id}:{parent}:{incoming_clock}");
                    if insert_conflict_entity(
                        &transaction,
                        workspace,
                        &conflict_id,
                        "whiteboard",
                        entity_id,
                        local.as_ref().map(|stored| &stored.value),
                        &change["value"],
                        batch,
                    )? {
                        conflicts += 1;
                        materialized_changes.push(json!({
                            "entityType": "conflict",
                            "entityId": conflict_id,
                            "baseRevision": 0,
                            "revision": 1,
                            "operation": "upsert",
                            "clock": incoming_clock,
                            "value": change["value"].clone()
                        }));
                    }
                    continue;
                }
                if entity_type == "card"
                    && local.is_some()
                    && batch["command"] != "conflicts.resolve"
                    && change["baseRevision"].as_i64()
                        != local.as_ref().map(|stored| stored.revision)
                {
                    let stored = local.as_ref().unwrap();
                    let local_device = stored.value["updatedByDeviceId"].as_str().unwrap_or("");
                    let remote_device = batch["deviceId"].as_str().unwrap_or("");
                    let mut participants = [
                        format!("{local_device}:{}", stored.revision),
                        format!("{remote_device}:{}", change["revision"]),
                    ];
                    participants.sort();
                    let conflict_id = format!(
                        "conflict:{entity_id}:{}:{}",
                        participants[0], participants[1]
                    );
                    let conflict_card_id = conflict_copy_card_id(&conflict_id);
                    conflict_copy_by_card_id.insert(entity_id.to_owned(), conflict_card_id.clone());
                    if insert_conflict_entity(
                        &transaction,
                        workspace,
                        &conflict_id,
                        "card",
                        entity_id,
                        Some(&stored.value),
                        &change["value"],
                        batch,
                    )? {
                        let placement_count = copy_conflict_dependents(
                            &transaction,
                            workspace,
                            entity_id,
                            &conflict_card_id,
                            &conflict_id,
                        )?;
                        if let Some(object) = materialized.as_object_mut() {
                            let title = object["derivedTitle"]
                                .as_str()
                                .unwrap_or("Untitled card")
                                .to_owned();
                            object.insert("id".into(), json!(conflict_card_id));
                            object
                                .insert("derivedTitle".into(), json!(format!("Conflict: {title}")));
                            object.insert("activePlacementCount".into(), json!(placement_count));
                        }
                        put_remote_entity(
                            &transaction,
                            workspace,
                            "card",
                            &conflict_card_id,
                            &materialized,
                            change["revision"].as_i64().unwrap(),
                            incoming_clock,
                            false,
                        )?;
                        if materialized.get("content").is_some() {
                            let content = legacy_card_content_value(
                                &materialized,
                                &conflict_card_id,
                                incoming_clock,
                                remote_device,
                            );
                            put_remote_entity(
                                &transaction,
                                workspace,
                                "cardContent",
                                &conflict_card_id,
                                &content,
                                change["revision"].as_i64().unwrap(),
                                incoming_clock,
                                false,
                            )?;
                        }
                        let mut conflict_change = change.clone();
                        conflict_change["entityId"] = json!(conflict_card_id);
                        conflict_change["value"] = materialized.clone();
                        materialized_changes.push(conflict_change);
                        conflicts += 1;
                    }
                    continue;
                }
                if matches!(entity_type, "canvasRecord" | "cardRelation") {
                    if let Some(stored) = &local {
                        let local_device = stored.value["updatedByDeviceId"].as_str().unwrap_or("");
                        let remote_device = batch["deviceId"].as_str().unwrap_or("");
                        if stored.clock.as_str() > incoming_clock
                            || (stored.clock == incoming_clock && local_device >= remote_device)
                        {
                            continue;
                        }
                    }
                }
                merge_hlc(&transaction, workspace, incoming_clock)?;
                let deleted = change["operation"] == "delete";
                put_remote_entity(
                    &transaction,
                    workspace,
                    entity_type,
                    &target_entity_id,
                    &materialized,
                    change["revision"].as_i64().unwrap(),
                    incoming_clock,
                    deleted,
                )?;
                applied += 1;
                let mut applied_change = change.clone();
                applied_change["entityId"] = json!(target_entity_id);
                applied_change["value"] = materialized.clone();
                materialized_changes.push(applied_change);
                if entity_type == "card" && materialized.get("content").is_some() {
                    let existing_content = read_stored_entity(
                        &transaction,
                        workspace,
                        "cardContent",
                        &target_entity_id,
                    )?;
                    if existing_content
                        .as_ref()
                        .map(|stored| stored.clock.as_str() < incoming_clock)
                        .unwrap_or(true)
                    {
                        let content = legacy_card_content_value(
                            &materialized,
                            &target_entity_id,
                            incoming_clock,
                            batch["deviceId"].as_str().unwrap_or(""),
                        );
                        put_remote_entity(
                            &transaction,
                            workspace,
                            "cardContent",
                            &target_entity_id,
                            &content,
                            change["revision"].as_i64().unwrap(),
                            incoming_clock,
                            deleted,
                        )?;
                        materialized_changes.push(json!({
                            "entityType": "cardContent",
                            "entityId": target_entity_id,
                            "baseRevision": change["baseRevision"].clone(),
                            "revision": change["revision"].clone(),
                            "operation": change["operation"].clone(),
                            "clock": incoming_clock,
                            "value": content
                        }));
                    }
                }
            }
            transaction.execute(
                "INSERT INTO applied_batches(workspace_id,change_id) VALUES(?1,?2)",
                params![workspace, change_id],
            )?;
        }
        let now = now_ms();
        transaction.execute(
            "INSERT INTO sync_peers(workspace_id,peer_id,cursor,updated_at,last_synced_at) VALUES(?1,?2,?3,?4,?4)
             ON CONFLICT(workspace_id,peer_id) DO UPDATE SET cursor=excluded.cursor,updated_at=excluded.updated_at,last_synced_at=excluded.last_synced_at",
            params![workspace, peer, cursor, now],
        )?;
        transaction.commit()?;
        Ok(json!({
            "applied": applied,
            "conflicts": conflicts,
            "materializedChanges": materialized_changes
        }))
    }

    pub fn sync_state(&self, workspace: &str, peer: &str) -> Result<Value, StorageError> {
        validate_id(workspace, "workspaceId")?;
        validate_id(peer, "peerId")?;
        let connection = self.connection.lock().expect("storage mutex poisoned");
        let row: Option<(String, i64, Option<i64>)> = connection.query_row(
            "SELECT cursor,updated_at,last_synced_at FROM sync_peers WHERE workspace_id=?1 AND peer_id=?2",
            params![workspace, peer], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).optional()?;
        Ok(match row {
            Some((cursor, updated, synced)) => {
                json!({"peerId":peer,"cursor":cursor,"enabled":true,"updatedAt":updated,"lastSyncedAt":synced,"lastAckAt":null})
            }
            None => {
                json!({"peerId":peer,"cursor":null,"enabled":true,"updatedAt":now_ms(),"lastSyncedAt":null,"lastAckAt":null})
            }
        })
    }

    pub fn update_sync_cursor(
        &self,
        workspace: &str,
        peer: &str,
        cursor: &str,
    ) -> Result<(), StorageError> {
        validate_id(workspace, "workspaceId")?;
        validate_id(peer, "peerId")?;
        validate_cursor(cursor)?;
        let mut connection = self.connection.lock().expect("storage mutex poisoned");
        let transaction = connection.transaction()?;
        ensure_workspace(&transaction, workspace)?;
        let now = now_ms();
        transaction.execute(
            "INSERT INTO sync_peers(workspace_id,peer_id,cursor,updated_at,last_synced_at) VALUES(?1,?2,?3,?4,?4)
             ON CONFLICT(workspace_id,peer_id) DO UPDATE SET cursor=excluded.cursor,updated_at=excluded.updated_at,last_synced_at=excluded.last_synced_at",
            params![workspace, peer, cursor, now],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn store_blob(
        &self,
        workspace: &str,
        descriptor: &BlobDescriptor,
        bytes: &[u8],
    ) -> Result<(), StorageError> {
        validate_id(workspace, "workspaceId")?;
        validate_hash(&descriptor.hash)?;
        if descriptor.content_type.is_empty()
            || descriptor.content_type.len() > 255
            || descriptor.size != bytes.len() as u64
        {
            return Err(StorageError::Invalid(
                "Blob descriptor does not match content".into(),
            ));
        }
        let digest = hex::encode(Sha256::digest(bytes));
        if digest != descriptor.hash {
            return Err(StorageError::Invalid("Blob hash mismatch".into()));
        }
        let final_path = self.blob_path(&descriptor.hash);
        if !final_path.exists() {
            let temp_path =
                self.root
                    .join("tmp")
                    .join(format!("{}.{}.tmp", descriptor.hash, Uuid::new_v4()));
            let mut file = File::create(&temp_path)?;
            file.write_all(bytes)?;
            file.sync_all()?;
            drop(file);
            match fs::rename(&temp_path, &final_path) {
                Ok(()) => {}
                Err(_error) if final_path.exists() => {
                    let _ = fs::remove_file(&temp_path);
                }
                Err(error) => return Err(error.into()),
            }
            sync_directory(final_path.parent().expect("blob parent"))?;
        }
        let mut connection = self.connection.lock().expect("storage mutex poisoned");
        let transaction = connection.transaction()?;
        ensure_workspace(&transaction, workspace)?;
        transaction.execute(
            "INSERT INTO blobs(hash,size,content_type,present) VALUES(?1,?2,?3,1)
             ON CONFLICT(hash) DO UPDATE SET size=excluded.size,content_type=excluded.content_type,present=1",
            params![descriptor.hash, descriptor.size, descriptor.content_type],
        )?;
        transaction.execute(
            "INSERT OR IGNORE INTO workspace_blobs(workspace_id,hash) VALUES(?1,?2)",
            params![workspace, descriptor.hash],
        )?;
        transaction.commit()?;
        Ok(())
    }

    pub fn read_blob(
        &self,
        workspace: &str,
        hash: &str,
    ) -> Result<Option<(BlobDescriptor, Vec<u8>)>, StorageError> {
        validate_id(workspace, "workspaceId")?;
        validate_hash(hash)?;
        let connection = self.connection.lock().expect("storage mutex poisoned");
        let descriptor: Option<(u64, String)> = connection
            .query_row(
                "SELECT b.size,b.content_type FROM blobs b JOIN workspace_blobs w ON w.hash=b.hash
             WHERE w.workspace_id=?1 AND b.hash=?2 AND b.present=1",
                params![workspace, hash],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;
        drop(connection);
        let Some((size, content_type)) = descriptor else {
            return Ok(None);
        };
        let mut bytes = Vec::new();
        File::open(self.blob_path(hash))?.read_to_end(&mut bytes)?;
        if bytes.len() as u64 != size || hex::encode(Sha256::digest(&bytes)) != hash {
            return Err(StorageError::Invalid(
                "Stored blob failed verification".into(),
            ));
        }
        Ok(Some((
            BlobDescriptor {
                hash: hash.into(),
                content_type,
                size,
            },
            bytes,
        )))
    }

    pub fn missing_blobs(&self, workspace: &str) -> Result<Vec<BlobDescriptor>, StorageError> {
        validate_id(workspace, "workspaceId")?;
        let connection = self.connection.lock().expect("storage mutex poisoned");
        let mut statement = connection.prepare(
            "SELECT b.hash,b.content_type,b.size FROM blobs b JOIN workspace_blobs w ON w.hash=b.hash WHERE w.workspace_id=?1 AND b.present=0"
        )?;
        let descriptors = statement
            .query_map([workspace], |row| {
                Ok(BlobDescriptor {
                    hash: row.get(0)?,
                    content_type: row.get(1)?,
                    size: row.get(2)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(descriptors)
    }

    /// Durable renderer-facing preferences. The key is checked against a fixed
    /// allowlist so the renderer cannot use this as a general key/value store.
    pub fn setting(&self, key: &str) -> Result<Option<String>, StorageError> {
        validate_setting_key(key)?;
        let connection = self.connection.lock().expect("storage mutex poisoned");
        Ok(connection
            .query_row("SELECT value FROM settings WHERE key=?1", [key], |row| {
                row.get(0)
            })
            .optional()?)
    }

    pub fn set_setting(&self, key: &str, value: &str) -> Result<(), StorageError> {
        validate_setting_key(key)?;
        if value.is_empty() || value.len() > 256 {
            return Err(StorageError::Invalid("Setting value is invalid".into()));
        }
        let connection = self.connection.lock().expect("storage mutex poisoned");
        connection.execute(
            "INSERT INTO settings(key,value) VALUES(?1,?2)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            params![key, value],
        )?;
        Ok(())
    }

    /// Stable per-workspace device identity, created on first use. Sync claims a
    /// workspace with it so the server can tell this device from the browser.
    pub fn device(&self, workspace: &str) -> Result<String, StorageError> {
        validate_id(workspace, "workspaceId")?;
        let mut connection = self.connection.lock().expect("storage mutex poisoned");
        let transaction = connection.transaction()?;
        ensure_workspace(&transaction, workspace)?;
        let id = device_id(&transaction, workspace)?;
        transaction.commit()?;
        Ok(id)
    }

    /// True when this workspace holds anything worth keeping. Sync uses it to
    /// decide whether the device may adopt a remote workspace id instead.
    pub fn has_data(&self, workspace: &str) -> Result<bool, StorageError> {
        validate_id(workspace, "workspaceId")?;
        let connection = self.connection.lock().expect("storage mutex poisoned");
        Ok(connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM entities WHERE workspace_id=?1 AND deleted=0)
                 OR EXISTS(SELECT 1 FROM pending_batches WHERE workspace_id=?1)",
            [workspace],
            |row| row.get(0),
        )?)
    }

    /// Lists workspace ids that have local entities or pending writes. Empty
    /// workspace rows are intentionally omitted because they are not useful
    /// merge sources in the settings UI.
    pub fn list_local_workspaces(&self) -> Result<Vec<String>, StorageError> {
        let connection = self.connection.lock().expect("storage mutex poisoned");
        let mut statement = connection.prepare(
            "SELECT id FROM workspaces
             WHERE EXISTS(SELECT 1 FROM entities WHERE workspace_id=workspaces.id AND deleted=0)
                OR EXISTS(SELECT 1 FROM pending_batches WHERE workspace_id=workspaces.id)
             ORDER BY id",
        )?;
        let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
        Ok(rows.collect::<Result<Vec<_>, _>>()?)
    }

    /// Replays the visible entities from one local workspace into another as
    /// fresh local writes. The source is left untouched so an interrupted or
    /// rejected push can be retried safely.
    pub fn merge_workspace(&self, from: &str, to: &str) -> Result<Value, StorageError> {
        validate_id(from, "workspaceId")?;
        validate_id(to, "workspaceId")?;
        if from == to {
            return Err(StorageError::Invalid(
                "Source and target workspaces must differ".into(),
            ));
        }

        let mut connection = self.connection.lock().expect("storage mutex poisoned");
        let transaction = connection.transaction()?;
        ensure_workspace(&transaction, to)?;

        let source_rows: Vec<(String, String, String)> = {
            let mut statement = transaction.prepare(
                "SELECT entity_type,entity_id,value_json
                 FROM entities
                 WHERE workspace_id=?1 AND deleted=0
                 ORDER BY entity_type,entity_id",
            )?;
            let rows =
                statement.query_map([from], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };

        let mut entity_count = 0usize;
        let mut batch_count = 0usize;
        for chunk in source_rows.chunks(MERGE_BATCH_SIZE) {
            let clock = tick_hlc(&transaction, to)?;
            let now = now_ms();
            let mut changes = Vec::with_capacity(chunk.len());

            for (entity_type, entity_id, value_json) in chunk.iter() {
                let existing_revision: Option<i64> = transaction
                    .query_row(
                        "SELECT revision FROM entities
                         WHERE workspace_id=?1 AND entity_type=?2 AND entity_id=?3",
                        params![to, entity_type, entity_id],
                        |row| row.get(0),
                    )
                    .optional()?;
                let revision = existing_revision.map_or(1, |value| value + 1);
                let mut materialized: Value = serde_json::from_str(value_json)?;
                if let Some(object) = materialized.as_object_mut() {
                    object.insert("id".into(), json!(entity_id));
                    object.insert("revision".into(), json!(revision));
                    object.insert("updatedAt".into(), json!(now));
                    object.insert("deletedAt".into(), Value::Null);
                }

                transaction.execute(
                    "INSERT INTO entities(workspace_id,entity_type,entity_id,value_json,revision,clock,deleted)
                     VALUES(?1,?2,?3,?4,?5,?6,0)
                     ON CONFLICT(workspace_id,entity_type,entity_id) DO UPDATE SET
                     value_json=excluded.value_json, revision=excluded.revision, clock=excluded.clock, deleted=excluded.deleted",
                    params![
                        to,
                        entity_type,
                        entity_id,
                        serde_json::to_string(&materialized)?,
                        revision,
                        &clock,
                    ],
                )?;
                changes.push(json!({
                    "entityType": entity_type,
                    "entityId": entity_id,
                    "baseRevision": existing_revision,
                    "revision": revision,
                    "operation": "upsert",
                    "clock": clock,
                    "value": materialized
                }));
            }

            let sequence = next_sequence(&transaction, to)?;
            let change_id = Uuid::new_v4().to_string();
            let batch = json!({
                "protocolVersion": 1,
                "schemaVersion": 2,
                "changeId": change_id,
                "workspaceId": to,
                "deviceId": device_id(&transaction, to)?,
                "deviceSequence": sequence,
                "clock": clock,
                "command": "workspace.merge",
                "createdAt": now,
                "changes": changes
            });
            transaction.execute(
                "INSERT INTO pending_batches(workspace_id,change_id,created_at,batch_json,valid)
                 VALUES(?1,?2,?3,?4,1)",
                params![to, change_id, now, serde_json::to_string(&batch)?],
            )?;
            transaction.execute(
                "INSERT INTO applied_batches(workspace_id,change_id) VALUES(?1,?2)",
                params![to, change_id],
            )?;
            entity_count += chunk.len();
            batch_count += 1;
        }

        transaction.execute(
            "INSERT OR IGNORE INTO workspace_blobs(workspace_id,hash)
             SELECT ?1,hash FROM workspace_blobs WHERE workspace_id=?2",
            params![to, from],
        )?;
        transaction.commit()?;

        Ok(json!({
            "entities": entity_count,
            "batches": batch_count
        }))
    }

    /// Permanently removes a non-active workspace from this device. Foreign
    /// keys cascade the workspace-scoped rows; content-addressed blobs are
    /// removed only when no other local workspace still references them.
    pub fn delete_workspace(&self, workspace: &str) -> Result<(), StorageError> {
        validate_id(workspace, "workspaceId")?;
        let mut connection = self.connection.lock().expect("storage mutex poisoned");
        let active: Option<String> = connection
            .query_row(
                "SELECT value FROM settings WHERE key='workspaceId'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        if active.as_deref() == Some(workspace) {
            return Err(StorageError::Invalid(
                "The active workspace cannot be deleted".into(),
            ));
        }

        let transaction = connection.transaction()?;
        transaction.execute("DELETE FROM workspaces WHERE id=?1", [workspace])?;
        let orphaned_hashes: Vec<String> = {
            let mut statement = transaction.prepare(
                "SELECT hash FROM blobs
                 WHERE NOT EXISTS(SELECT 1 FROM workspace_blobs WHERE hash=blobs.hash)",
            )?;
            let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
            rows.collect::<Result<Vec<_>, _>>()?
        };
        for hash in &orphaned_hashes {
            transaction.execute("DELETE FROM blobs WHERE hash=?1", [hash])?;
        }
        transaction.commit()?;

        // The database is authoritative. If a file cannot be removed now,
        // it is an orphan and the existing startup recovery pass will remove
        // it on the next open without affecting any remaining workspace.
        for hash in orphaned_hashes {
            let path = self.blob_path(&hash);
            if let Err(error) = fs::remove_file(path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    continue;
                }
            }
        }
        Ok(())
    }

    /// Renames a workspace in place, keeping its device identity, HLC and blob
    /// ownership. Foreign keys are deferred so the parent row can move before
    /// its children.
    pub fn adopt_workspace(&self, from: &str, to: &str) -> Result<(), StorageError> {
        validate_id(from, "workspaceId")?;
        validate_id(to, "workspaceId")?;
        if from == to {
            return Ok(());
        }
        let mut connection = self.connection.lock().expect("storage mutex poisoned");
        let transaction = connection.transaction()?;
        transaction.pragma_update(None, "defer_foreign_keys", true)?;
        let taken: bool = transaction.query_row(
            "SELECT EXISTS(SELECT 1 FROM workspaces WHERE id=?1)",
            [to],
            |row| row.get(0),
        )?;
        if taken {
            return Err(StorageError::Invalid(
                "The target workspace already exists on this device".into(),
            ));
        }
        ensure_workspace(&transaction, from)?;
        transaction.execute("UPDATE workspaces SET id=?2 WHERE id=?1", params![from, to])?;
        for table in [
            "entities",
            "pending_batches",
            "applied_batches",
            "sync_peers",
            "workspace_blobs",
        ] {
            transaction.execute(
                &format!("UPDATE {table} SET workspace_id=?2 WHERE workspace_id=?1"),
                params![from, to],
            )?;
        }
        // Rebinding changes the server workspace's cursor namespace. Replaying
        // from the beginning is required because target history may contain
        // changes whose global cursors predate this device's old cursor.
        transaction.execute("DELETE FROM sync_peers WHERE workspace_id=?1", [to])?;
        // Pending batches carry the workspace id in their serialized payload, so
        // they would fail validation on push if they kept pointing at the old id.
        let stale: Vec<(String, String)> = {
            let mut statement = transaction.prepare(
                "SELECT change_id,batch_json FROM pending_batches WHERE workspace_id=?1",
            )?;
            let rows = statement
                .query_map([to], |row| Ok((row.get(0)?, row.get(1)?)))?
                .collect::<Result<Vec<(String, String)>, _>>()?;
            rows
        };
        for (change_id, batch_json) in stale {
            let mut batch: Value = serde_json::from_str(&batch_json)?;
            batch["workspaceId"] = json!(to);
            transaction.execute(
                "UPDATE pending_batches SET batch_json=?3 WHERE workspace_id=?1 AND change_id=?2",
                params![to, change_id, serde_json::to_string(&batch)?],
            )?;
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn recover(&self) -> Result<RecoveryReport, StorageError> {
        let mut report = RecoveryReport {
            stale_temps_removed: 0,
            missing_blobs_marked: 0,
            orphan_blobs_removed: 0,
            invalid_pending_removed: 0,
        };
        for entry in fs::read_dir(self.root.join("tmp"))? {
            let path = entry?.path();
            if path.is_file() {
                fs::remove_file(path)?;
                report.stale_temps_removed += 1;
            }
        }
        let mut connection = self.connection.lock().expect("storage mutex poisoned");
        let transaction = connection.transaction()?;
        let known = {
            let mut statement = transaction.prepare("SELECT hash,present FROM blobs")?;
            let values = statement
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, bool>(1)?))
                })?
                .collect::<Result<Vec<_>, _>>()?;
            values
        };
        for (hash, present) in &known {
            if *present && !self.blob_path(hash).exists() {
                transaction.execute("UPDATE blobs SET present=0 WHERE hash=?1", [hash])?;
                report.missing_blobs_marked += 1;
            }
        }
        let valid_hashes = known
            .into_iter()
            .map(|v| v.0)
            .collect::<std::collections::HashSet<_>>();
        for entry in fs::read_dir(self.root.join("blobs"))? {
            let path = entry?.path();
            let name = path.file_name().and_then(|v| v.to_str()).unwrap_or("");
            if path.is_file() && !valid_hashes.contains(name) {
                fs::remove_file(path)?;
                report.orphan_blobs_removed += 1;
            }
        }
        let pending = {
            let mut statement = transaction
                .prepare("SELECT workspace_id,change_id,batch_json FROM pending_batches")?;
            let values = statement
                .query_map([], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                    ))
                })?
                .collect::<Result<Vec<_>, rusqlite::Error>>()?;
            values
        };
        for (workspace, id, batch_json) in pending {
            let Ok(mut batch) = serde_json::from_str::<Value>(&batch_json) else {
                transaction.execute(
                    "DELETE FROM pending_batches WHERE workspace_id=?1 AND change_id=?2",
                    params![workspace, id],
                )?;
                report.invalid_pending_removed += 1;
                continue;
            };
            if validate_batch(&batch, &workspace).is_ok() {
                continue;
            }
            if normalize_legacy_batch_operations(&mut batch)
                && validate_batch(&batch, &workspace).is_ok()
            {
                transaction.execute(
                    "UPDATE pending_batches SET batch_json=?3 WHERE workspace_id=?1 AND change_id=?2",
                    params![workspace, id, serde_json::to_string(&batch)?],
                )?;
                continue;
            }
            transaction.execute(
                "DELETE FROM pending_batches WHERE workspace_id=?1 AND change_id=?2",
                params![workspace, id],
            )?;
            report.invalid_pending_removed += 1;
        }
        transaction.commit()?;
        Ok(report)
    }

    fn blob_path(&self, hash: &str) -> PathBuf {
        self.root.join("blobs").join(hash)
    }
}

struct StoredEntity {
    clock: String,
    value: Value,
    revision: i64,
}

fn legacy_card_content_value(card: &Value, card_id: &str, clock: &str, device_id: &str) -> Value {
    json!({
        "id": card_id,
        "cardId": card_id,
        "document": card.get("content").cloned().unwrap_or_else(|| json!({"type":"doc","content":[]})),
        "contentVersion": card.get("contentVersion").and_then(Value::as_i64).unwrap_or(1),
        "revision": card.get("revision").and_then(Value::as_i64).unwrap_or(1),
        "clock": clock,
        "createdAt": card.get("createdAt").and_then(Value::as_i64).unwrap_or_else(now_ms),
        "updatedAt": card.get("updatedAt").and_then(Value::as_i64).unwrap_or_else(now_ms),
        "updatedByDeviceId": card.get("updatedByDeviceId").and_then(Value::as_str).unwrap_or(device_id),
        "deletedAt": card.get("deletedAt").cloned().unwrap_or(Value::Null)
    })
}

fn read_stored_entity(
    transaction: &Transaction<'_>,
    workspace: &str,
    entity_type: &str,
    entity_id: &str,
) -> Result<Option<StoredEntity>, StorageError> {
    transaction
        .query_row(
            "SELECT clock,value_json,revision FROM entities
             WHERE workspace_id=?1 AND entity_type=?2 AND entity_id=?3",
            params![workspace, entity_type, entity_id],
            |row| {
                let value_json: String = row.get(1)?;
                Ok(StoredEntity {
                    clock: row.get(0)?,
                    value: serde_json::from_str(&value_json).unwrap_or(Value::Null),
                    revision: row.get(2)?,
                })
            },
        )
        .optional()
        .map_err(Into::into)
}

fn normalize_remote_value(entity_type: &str, clock: &str, value: &mut Value) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    if entity_type == "file" {
        let hash = object
            .get("hash")
            .or_else(|| object.get("sha256"))
            .cloned()
            .unwrap_or(json!(""));
        object.insert("sha256".into(), hash);
        object.remove("blob");
    }
    if matches!(entity_type, "canvasRecord" | "cardRelation") {
        object.insert("clock".into(), json!(clock));
    }
}

fn invalid_remote_hierarchy(
    transaction: &Transaction<'_>,
    workspace: &str,
    whiteboard_id: &str,
    parent_id: Option<&str>,
) -> Result<bool, StorageError> {
    let mut seen = HashSet::from([whiteboard_id.to_owned()]);
    let mut cursor = parent_id.map(str::to_owned);
    while let Some(parent) = cursor {
        if !seen.insert(parent.clone()) {
            return Ok(true);
        }
        let stored = read_stored_entity(transaction, workspace, "whiteboard", &parent)?;
        let Some(stored) = stored else {
            return Ok(true);
        };
        if stored.value["deletedAt"].is_number() {
            return Ok(true);
        }
        cursor = stored.value["parentWhiteboardId"]
            .as_str()
            .map(str::to_owned);
    }
    Ok(false)
}

fn copy_conflict_dependents(
    transaction: &Transaction<'_>,
    workspace: &str,
    source_card_id: &str,
    conflict_card_id: &str,
    conflict_id: &str,
) -> Result<usize, StorageError> {
    let mut copied_placements = 0usize;
    for (entity_type, predicate, replacement_field, namespace) in [
        (
            "boardItem",
            ("$.cardId", source_card_id.to_owned()),
            "cardId",
            "conflict-placement",
        ),
        (
            "cardReference",
            ("$.sourceCardId", source_card_id.to_owned()),
            "sourceCardId",
            "conflict-reference",
        ),
        (
            "fileReference",
            ("$.targetKey", format!("card:{source_card_id}")),
            "targetKey",
            "conflict-file-reference",
        ),
    ] {
        let rows = {
            let mut statement = transaction.prepare(
                "SELECT entity_id,value_json,revision,clock FROM entities
                 WHERE workspace_id=?1 AND entity_type=?2 AND deleted=0
                   AND json_extract(value_json,?3)=?4",
            )?;
            let collected = statement
                .query_map(
                    params![workspace, entity_type, predicate.0, predicate.1],
                    |row| {
                        Ok((
                            row.get::<_, String>(0)?,
                            row.get::<_, String>(1)?,
                            row.get::<_, i64>(2)?,
                            row.get::<_, String>(3)?,
                        ))
                    },
                )?
                .collect::<Result<Vec<_>, _>>()?;
            collected
        };
        for (index, (source_id, value_json, revision, clock)) in rows.into_iter().enumerate() {
            let mut value: Value = serde_json::from_str(&value_json)?;
            if entity_type == "boardItem" && value["archivedAt"].is_number() {
                continue;
            }
            let copied_id = deterministic_entity_id(namespace, &[conflict_id, &source_id]);
            let copied_shape_id = (entity_type == "boardItem").then(|| {
                deterministic_entity_id(
                    "conflict-shape",
                    &[conflict_id, value["shapeId"].as_str().unwrap_or("")],
                )
            });
            let source_x = value["x"].as_f64().unwrap_or(0.0);
            let source_y = value["y"].as_f64().unwrap_or(0.0);
            if let Some(object) = value.as_object_mut() {
                object.insert("id".into(), json!(copied_id));
                object.insert(
                    replacement_field.into(),
                    json!(if replacement_field == "targetKey" {
                        format!("card:{conflict_card_id}")
                    } else {
                        conflict_card_id.to_owned()
                    }),
                );
                if entity_type == "boardItem" {
                    let offset = 48.0 * (index as f64 + 1.0);
                    object.insert("shapeId".into(), json!(copied_shape_id));
                    object.insert("x".into(), json!(source_x + offset));
                    object.insert("y".into(), json!(source_y + offset));
                    copied_placements += 1;
                }
            }
            put_remote_entity(
                transaction,
                workspace,
                entity_type,
                &copied_id,
                &value,
                revision,
                &clock,
                false,
            )?;
        }
    }
    Ok(copied_placements)
}

#[allow(clippy::too_many_arguments)]
fn put_remote_entity(
    transaction: &Transaction<'_>,
    workspace: &str,
    entity_type: &str,
    entity_id: &str,
    value: &Value,
    revision: i64,
    clock: &str,
    deleted: bool,
) -> Result<(), StorageError> {
    transaction.execute(
        "INSERT INTO entities(workspace_id,entity_type,entity_id,value_json,revision,clock,deleted)
         VALUES(?1,?2,?3,?4,?5,?6,?7)
         ON CONFLICT(workspace_id,entity_type,entity_id) DO UPDATE SET
         value_json=excluded.value_json,revision=excluded.revision,clock=excluded.clock,deleted=excluded.deleted",
        params![
            workspace,
            entity_type,
            entity_id,
            serde_json::to_string(value)?,
            revision,
            clock,
            deleted
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn insert_conflict_entity(
    transaction: &Transaction<'_>,
    workspace: &str,
    conflict_id: &str,
    entity_type: &str,
    entity_id: &str,
    local_value: Option<&Value>,
    remote_value: &Value,
    batch: &Value,
) -> Result<bool, StorageError> {
    if read_stored_entity(transaction, workspace, "conflict", conflict_id)?.is_some() {
        return Ok(false);
    }
    let created_at = batch["createdAt"].as_i64().unwrap_or(0);
    let device_id = batch["deviceId"].as_str().unwrap_or("");
    let value = json!({
        "id": conflict_id,
        "conflictId": conflict_id,
        "entityType": entity_type,
        "entityId": entity_id,
        "localValue": local_value.cloned().unwrap_or(Value::Null),
        "remoteValue": remote_value,
        "createdAt": created_at,
        "resolvedAt": Value::Null,
        "resolution": Value::Null,
        "revision": 1,
        "updatedAt": created_at,
        "updatedByDeviceId": device_id,
        "deletedAt": Value::Null,
    });
    put_remote_entity(
        transaction,
        workspace,
        "conflict",
        conflict_id,
        &value,
        1,
        batch["clock"].as_str().unwrap_or(""),
        false,
    )?;
    Ok(true)
}

fn hash32(value: &str, seed: u32) -> String {
    let hash = value.encode_utf16().fold(seed, |hash, unit| {
        (hash ^ u32::from(unit)).wrapping_mul(0x0100_0193)
    });
    format!("{hash:08x}")
}

fn deterministic_entity_id(namespace: &str, parts: &[&str]) -> String {
    let value = parts
        .iter()
        .map(|part| format!("{}:{part}", part.encode_utf16().count()))
        .collect::<Vec<_>>()
        .join("|");
    format!(
        "{namespace}:{}{}{}{}",
        hash32(&value, 0x811c_9dc5),
        hash32(&value, 0x9e37_79b9),
        hash32(&value, 0x85eb_ca6b),
        hash32(&value, 0xc2b2_ae35)
    )
}

fn conflict_copy_card_id(conflict_id: &str) -> String {
    deterministic_entity_id("conflict-card", &[conflict_id])
}

fn migrate(connection: &Connection) -> Result<(), StorageError> {
    connection.execute_batch("BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS schema_meta(version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY, device_id TEXT NOT NULL, device_sequence INTEGER NOT NULL DEFAULT 0, hlc_millis INTEGER NOT NULL DEFAULT 0, hlc_counter INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS entities(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, value_json TEXT NOT NULL, revision INTEGER NOT NULL, clock TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(workspace_id,entity_type,entity_id));
      CREATE TABLE IF NOT EXISTS pending_batches(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, change_id TEXT NOT NULL, created_at INTEGER NOT NULL, batch_json TEXT NOT NULL, valid INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(workspace_id,change_id));
	  CREATE INDEX IF NOT EXISTS pending_batches_poll ON pending_batches(workspace_id,valid,created_at,change_id);
      CREATE TABLE IF NOT EXISTS applied_batches(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, change_id TEXT NOT NULL, PRIMARY KEY(workspace_id,change_id));
      CREATE TABLE IF NOT EXISTS sync_peers(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, peer_id TEXT NOT NULL, cursor TEXT NOT NULL, updated_at INTEGER NOT NULL, last_synced_at INTEGER, PRIMARY KEY(workspace_id,peer_id));
      CREATE TABLE IF NOT EXISTS blobs(hash TEXT PRIMARY KEY,size INTEGER NOT NULL,content_type TEXT NOT NULL,present INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS workspace_blobs(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,hash TEXT NOT NULL REFERENCES blobs(hash) ON DELETE CASCADE,PRIMARY KEY(workspace_id,hash));
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS entities_whiteboard ON entities(workspace_id, entity_type, json_extract(value_json, '$.whiteboardId'));
      CREATE INDEX IF NOT EXISTS entities_card ON entities(workspace_id, entity_type, json_extract(value_json, '$.cardId'));
      CREATE INDEX IF NOT EXISTS entities_child_whiteboard ON entities(workspace_id, entity_type, json_extract(value_json, '$.childWhiteboardId'));
      CREATE INDEX IF NOT EXISTS entities_parent_whiteboard ON entities(workspace_id, entity_type, json_extract(value_json, '$.parentWhiteboardId'));
      CREATE INDEX IF NOT EXISTS entities_source_card ON entities(workspace_id, entity_type, json_extract(value_json, '$.sourceCardId'));
      CREATE INDEX IF NOT EXISTS entities_target_card ON entities(workspace_id, entity_type, json_extract(value_json, '$.targetCardId'));
      CREATE INDEX IF NOT EXISTS entities_target_whiteboard ON entities(workspace_id, entity_type, json_extract(value_json, '$.targetWhiteboardId'));
      CREATE INDEX IF NOT EXISTS entities_target_key ON entities(workspace_id, entity_type, json_extract(value_json, '$.targetKey'));
      CREATE INDEX IF NOT EXISTS entities_file ON entities(workspace_id, entity_type, json_extract(value_json, '$.fileId'));
      COMMIT;")?;
    let version: Option<i64> = connection
        .query_row("SELECT version FROM schema_meta LIMIT 1", [], |r| r.get(0))
        .optional()?;
    match version {
        None => {
            connection.execute(
                "INSERT INTO schema_meta(version) VALUES(?1)",
                [SCHEMA_VERSION],
            )?;
        }
        Some(value) if value == SCHEMA_VERSION => {}
        Some(1) => {
            migrate_card_content_entities(connection)?;
            migrate_whiteboard_reference_indexes(connection)?;
            connection.execute("UPDATE schema_meta SET version=?1", [SCHEMA_VERSION])?;
        }
        Some(2) => {
            migrate_whiteboard_reference_indexes(connection)?;
            connection.execute("UPDATE schema_meta SET version=?1", [SCHEMA_VERSION])?;
        }
        Some(value) => {
            return Err(StorageError::Invalid(format!(
                "Unsupported schema version {value}"
            )))
        }
    }
    Ok(())
}

fn migrate_whiteboard_reference_indexes(connection: &Connection) -> Result<(), StorageError> {
    connection.execute_batch(
        "CREATE INDEX IF NOT EXISTS entities_source_card ON entities(workspace_id, entity_type, json_extract(value_json, '$.sourceCardId'));
         CREATE INDEX IF NOT EXISTS entities_target_whiteboard ON entities(workspace_id, entity_type, json_extract(value_json, '$.targetWhiteboardId'));",
    )?;
    Ok(())
}

fn migrate_card_content_entities(connection: &Connection) -> Result<(), StorageError> {
    let cards = {
        let mut statement = connection.prepare(
            "SELECT workspace_id,entity_id,value_json,revision,clock,deleted
             FROM entities WHERE entity_type='card'",
        )?;
        let rows = statement
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, i64>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, bool>(5)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?;
        rows
    };
    for (workspace, card_id, value_json, revision, clock, deleted) in cards {
        let card: Value = serde_json::from_str(&value_json)?;
        let content = json!({
            "id": card_id,
            "cardId": card_id,
            "document": card.get("content").cloned().unwrap_or(Value::Null),
            "contentVersion": card.get("contentVersion").cloned().unwrap_or(json!(1)),
            "revision": revision,
            "clock": clock,
            "createdAt": card.get("createdAt").cloned().unwrap_or(json!(0)),
            "updatedAt": card.get("updatedAt").cloned().unwrap_or(json!(0)),
            "updatedByDeviceId": card.get("updatedByDeviceId").cloned().unwrap_or(json!("migration")),
            "deletedAt": card.get("deletedAt").cloned().unwrap_or(Value::Null),
        });
        connection.execute(
            "INSERT OR IGNORE INTO entities(workspace_id,entity_type,entity_id,value_json,revision,clock,deleted)
             VALUES(?1,'cardContent',?2,?3,?4,?5,?6)",
            params![workspace, card_id, serde_json::to_string(&content)?, revision, clock, deleted],
        )?;
    }
    Ok(())
}

fn ensure_workspace(tx: &Transaction<'_>, workspace: &str) -> Result<(), StorageError> {
    tx.execute(
        "INSERT OR IGNORE INTO workspaces(id,device_id) VALUES(?1,?2)",
        params![workspace, Uuid::new_v4().to_string()],
    )?;
    Ok(())
}
fn device_id(tx: &Transaction<'_>, workspace: &str) -> Result<String, StorageError> {
    Ok(tx.query_row(
        "SELECT device_id FROM workspaces WHERE id=?1",
        [workspace],
        |r| r.get(0),
    )?)
}
fn next_sequence(tx: &Transaction<'_>, workspace: &str) -> Result<i64, StorageError> {
    tx.execute(
        "UPDATE workspaces SET device_sequence=device_sequence+1 WHERE id=?1",
        [workspace],
    )?;
    Ok(tx.query_row(
        "SELECT device_sequence FROM workspaces WHERE id=?1",
        [workspace],
        |r| r.get(0),
    )?)
}
fn tick_hlc(tx: &Transaction<'_>, workspace: &str) -> Result<String, StorageError> {
    let (millis, counter, device): (i64, i64, String) = tx.query_row(
        "SELECT hlc_millis,hlc_counter,device_id FROM workspaces WHERE id=?1",
        [workspace],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
    )?;
    let now = now_ms();
    let (next_millis, next_counter) = if now > millis {
        (now, 0)
    } else {
        (millis, counter + 1)
    };
    tx.execute(
        "UPDATE workspaces SET hlc_millis=?2,hlc_counter=?3 WHERE id=?1",
        params![workspace, next_millis, next_counter],
    )?;
    Ok(format!("{next_millis:013}:{next_counter:06}:{device}"))
}
fn merge_hlc(tx: &Transaction<'_>, workspace: &str, remote: &str) -> Result<(), StorageError> {
    let parts: Vec<&str> = remote.split(':').collect();
    if parts.len() < 3 {
        return Err(StorageError::Invalid("Invalid HLC".into()));
    }
    let remote_millis = parts[0]
        .parse::<i64>()
        .map_err(|_| StorageError::Invalid("Invalid HLC".into()))?;
    let remote_counter = parts[1]
        .parse::<i64>()
        .map_err(|_| StorageError::Invalid("Invalid HLC".into()))?;
    let (local_millis, local_counter): (i64, i64) = tx.query_row(
        "SELECT hlc_millis,hlc_counter FROM workspaces WHERE id=?1",
        [workspace],
        |r| Ok((r.get(0)?, r.get(1)?)),
    )?;
    let next_millis = now_ms().max(local_millis).max(remote_millis);
    let next_counter = if next_millis == local_millis && next_millis == remote_millis {
        local_counter.max(remote_counter) + 1
    } else if next_millis == local_millis {
        local_counter + 1
    } else if next_millis == remote_millis {
        remote_counter + 1
    } else {
        0
    };
    tx.execute(
        "UPDATE workspaces SET hlc_millis=?2,hlc_counter=?3 WHERE id=?1",
        params![workspace, next_millis, next_counter],
    )?;
    Ok(())
}
fn operation(value: &Value) -> Result<&str, StorageError> {
    value
        .get("type")
        .and_then(Value::as_str)
        .ok_or(StorageError::UnknownOperation)
}

struct EntityListFilter {
    ids: Option<Vec<String>>,
    whiteboard_id: Option<Option<String>>,
    predicates: Vec<(String, Vec<Option<String>>)>,
    card_ids: Option<Vec<String>>,
    search_term: Option<String>,
    limit: Option<usize>,
    summary: bool,
}

fn parse_entity_list_filter(
    input: Option<&serde_json::Map<String, Value>>,
    entity_type: &str,
) -> Result<EntityListFilter, StorageError> {
    let summary = match input.and_then(|value| value.get("projection")) {
        None => false,
        Some(Value::String(value)) if value == "full" && matches!(entity_type, "card" | "file") => {
            false
        }
        Some(Value::String(value))
            if value == "summary" && matches!(entity_type, "card" | "file") =>
        {
            true
        }
        Some(_) => {
            return Err(StorageError::Invalid(format!(
                "projection is not supported for {entity_type}"
            )))
        }
    };
    let search_term = match input.and_then(|value| value.get("searchTerm")) {
        None => None,
        Some(Value::String(value)) if matches!(entity_type, "card" | "whiteboard") => {
            Some(value.trim().to_lowercase())
        }
        Some(_) => {
            return Err(StorageError::Invalid(format!(
                "searchTerm filtering is not supported for {entity_type}"
            )))
        }
    };
    let limit = match input.and_then(|value| value.get("limit")) {
        None => None,
        Some(Value::Number(value)) if matches!(entity_type, "card" | "whiteboard") => {
            let value = value
                .as_u64()
                .filter(|value| (1..=100).contains(value))
                .ok_or_else(|| {
                    StorageError::Invalid("limit must be an integer between 1 and 100".into())
                })?;
            Some(value as usize)
        }
        Some(_) => {
            return Err(StorageError::Invalid(format!(
                "limit filtering is not supported for {entity_type}"
            )))
        }
    };
    let ids = match input.and_then(|value| value.get("ids")) {
        None => None,
        Some(value) => {
            let values = value
                .as_array()
                .ok_or_else(|| StorageError::Invalid("ids must be an array".into()))?;
            let mut ids = Vec::with_capacity(values.len());
            for value in values {
                let id = value.as_str().ok_or_else(|| {
                    StorageError::Invalid("ids must contain non-empty strings".into())
                })?;
                validate_id(id, "entityId")?;
                ids.push(id.to_owned());
            }
            ids.sort();
            ids.dedup();
            Some(ids)
        }
    };

    let whiteboard_id = match input.and_then(|value| value.get("whiteboardId")) {
        None => None,
        Some(value) => {
            if !matches!(
                entity_type,
                "boardItem" | "canvasRecord" | "tldrawDocument" | "cardRelation"
            ) {
                return Err(StorageError::Invalid(format!(
                    "whiteboardId filtering is not supported for {entity_type}"
                )));
            }
            Some(match value {
                Value::Null => None,
                Value::String(value) => {
                    validate_id(value, "whiteboardId")?;
                    Some(value.clone())
                }
                _ => {
                    return Err(StorageError::Invalid(
                        "whiteboardId must be a string or null".into(),
                    ))
                }
            })
        }
    };
    let mut predicates = Vec::new();
    let mut card_ids = None;
    if let Some(input) = input {
        for (key, value) in input {
            if matches!(
                key.as_str(),
                "ids" | "whiteboardId" | "searchTerm" | "limit" | "projection"
            ) {
                continue;
            }
            let field = match (entity_type, key.as_str()) {
                (
                    "boardItem" | "canvasRecord" | "tldrawDocument" | "cardRelation",
                    "whiteboardIds",
                ) => "whiteboardId",
                ("boardItem", "cardIds")
                | ("cardContent", "cardIds")
                | ("cardRelation", "cardIds") => {
                    let values = value
                        .as_array()
                        .ok_or_else(|| StorageError::Invalid(format!("{key} must be an array")))?;
                    let parsed = values
                        .iter()
                        .map(|entry| {
                            entry.as_str().map(str::to_owned).ok_or_else(|| {
                                StorageError::Invalid(format!(
                                    "{key} must contain non-empty strings"
                                ))
                            })
                        })
                        .collect::<Result<Vec<_>, _>>()?;
                    card_ids = Some(parsed);
                    continue;
                }
                ("boardItem", "childWhiteboardIds") => "childWhiteboardId",
                ("whiteboard", "parentWhiteboardIds") => "parentWhiteboardId",
                ("cardReference", "sourceCardIds") => "sourceCardId",
                ("cardReference", "targetCardIds") => "targetCardId",
                ("whiteboardReference", "sourceCardIds") => "sourceCardId",
                ("whiteboardReference", "targetWhiteboardIds") => "targetWhiteboardId",
                ("fileReference", "targetKeys") => "targetKey",
                ("fileReference", "fileIds") => "fileId",
                _ => {
                    return Err(StorageError::Invalid(format!(
                        "{key} filtering is not supported for {entity_type}"
                    )))
                }
            };
            let values = value
                .as_array()
                .ok_or_else(|| StorageError::Invalid(format!("{key} must be an array")))?;
            let allows_null = matches!(key.as_str(), "whiteboardIds" | "parentWhiteboardIds");
            let parsed = values
                .iter()
                .map(|entry| match entry {
                    Value::Null if allows_null => Ok(None),
                    Value::String(text) if !text.is_empty() => Ok(Some(text.clone())),
                    _ => Err(StorageError::Invalid(format!(
                        "{key} must contain non-empty strings{}",
                        if allows_null { " or null" } else { "" }
                    ))),
                })
                .collect::<Result<Vec<_>, _>>()?;
            predicates.push((field.to_owned(), parsed));
        }
    }

    Ok(EntityListFilter {
        ids,
        whiteboard_id,
        predicates,
        card_ids,
        search_term,
        limit,
        summary,
    })
}

fn query_entity_list(
    connection: &Connection,
    workspace: &str,
    entity_type: &str,
    input: Option<&serde_json::Map<String, Value>>,
) -> Result<Vec<Value>, StorageError> {
    let filter = parse_entity_list_filter(input, entity_type)?;
    if filter.ids.as_ref().is_some_and(Vec::is_empty) {
        return Ok(Vec::new());
    }

    let empty_ids: &[String] = &[];
    let chunks = filter
        .ids
        .as_deref()
        .map(|ids| ids.chunks(LIST_QUERY_CHUNK_SIZE).collect::<Vec<_>>())
        .unwrap_or_else(|| vec![empty_ids]);
    let mut values = Vec::<(String, Value)>::new();

    for ids in chunks {
        let selected_json = match (filter.summary, entity_type) {
            (true, "card") => "json_remove(value_json, '$.content')",
            (true, "file") => "json_remove(value_json, '$.blob')",
            _ => "value_json",
        };
        let mut sql = format!(
            "SELECT entity_id, {selected_json} FROM entities WHERE workspace_id=? AND entity_type=? AND deleted=0",
        );
        let mut parameters = vec![
            SqlValue::Text(workspace.to_owned()),
            SqlValue::Text(entity_type.to_owned()),
        ];

        if !ids.is_empty() {
            sql.push_str(" AND entity_id IN (");
            sql.push_str(&vec!["?"; ids.len()].join(","));
            sql.push(')');
            parameters.extend(ids.iter().cloned().map(SqlValue::Text));
        }

        if let Some(whiteboard_id) = &filter.whiteboard_id {
            match whiteboard_id {
                Some(whiteboard_id) => {
                    sql.push_str(" AND json_extract(value_json, '$.whiteboardId') = ?");
                    parameters.push(SqlValue::Text(whiteboard_id.clone()));
                }
                None => sql.push_str(" AND json_extract(value_json, '$.whiteboardId') IS NULL"),
            }
        }

        for (field, values) in &filter.predicates {
            if values.is_empty() {
                sql.push_str(" AND 0=1");
                continue;
            }
            let strings = values.iter().flatten().collect::<Vec<_>>();
            let has_null = values.iter().any(Option::is_none);
            sql.push_str(" AND (");
            if !strings.is_empty() {
                sql.push_str(&format!(
                    "json_extract(value_json, '$.{field}') IN ({})",
                    vec!["?"; strings.len()].join(",")
                ));
                parameters.extend(strings.into_iter().cloned().map(SqlValue::Text));
                if has_null {
                    sql.push_str(" OR ");
                }
            }
            if has_null {
                sql.push_str(&format!("json_extract(value_json, '$.{field}') IS NULL"));
            }
            sql.push(')');
        }

        if let Some(card_ids) = &filter.card_ids {
            if card_ids.is_empty() {
                sql.push_str(" AND 0=1");
            } else {
                let placeholders = vec!["?"; card_ids.len()].join(",");
                if entity_type == "cardRelation" {
                    sql.push_str(&format!(" AND (json_extract(value_json, '$.sourceCardId') IN ({placeholders}) OR json_extract(value_json, '$.targetCardId') IN ({placeholders}))"));
                    parameters.extend(card_ids.iter().cloned().map(SqlValue::Text));
                    parameters.extend(card_ids.iter().cloned().map(SqlValue::Text));
                } else {
                    sql.push_str(&format!(
                        " AND json_extract(value_json, '$.cardId') IN ({placeholders})"
                    ));
                    parameters.extend(card_ids.iter().cloned().map(SqlValue::Text));
                }
            }
        }

        if let Some(term) = &filter.search_term {
            if entity_type == "card" {
                sql.push_str(" AND instr(lower(coalesce(json_extract(value_json, '$.derivedTitle'), '') || ' ' || coalesce(json_extract(value_json, '$.plainText'), '') || ' ' || coalesce(json_extract(value_json, '$.preview'), '')), ?) > 0");
            } else {
                sql.push_str(
                    " AND instr(lower(coalesce(json_extract(value_json, '$.title'), '')), ?) > 0",
                );
            }
            parameters.push(SqlValue::Text(term.clone()));
        }

        if filter.search_term.is_some() {
            sql.push_str(" ORDER BY CAST(json_extract(value_json, '$.updatedAt') AS INTEGER) DESC, entity_id");
        } else {
            sql.push_str(" ORDER BY entity_id");
        }
        if let Some(limit) = filter.limit {
            sql.push_str(&format!(" LIMIT {limit}"));
        }
        let mut statement = connection.prepare(&sql)?;
        let rows = statement.query_map(params_from_iter(parameters.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        for row in rows {
            let (id, value_json) = row?;
            values.push((id, serde_json::from_str(&value_json)?));
        }
    }

    values.sort_by(|left, right| left.0.cmp(&right.0));
    Ok(values.into_iter().map(|(_, value)| value).collect())
}

fn query_operation(value: &str) -> Option<(&'static str, &'static str)> {
    let (prefix, action) = value.split_once('.')?;
    let entity = match prefix {
        "cards" => "card",
        "cardContents" => "cardContent",
        "whiteboards" => "whiteboard",
        "items" => "boardItem",
        "records" => "canvasRecord",
        "tldrawDocuments" => "tldrawDocument",
        "files" => "file",
        "fileReferences" => "fileReference",
        "cardReferences" => "cardReference",
        "whiteboardReferences" => "whiteboardReference",
        "cardRelations" => "cardRelation",
        "conflicts" => "conflict",
        "todos" => "todo",
        _ => return None,
    };
    match action {
        "list" => Some((entity, "list")),
        "get" => Some((entity, "get")),
        _ => None,
    }
}
fn command_operation(value: &str) -> Option<(&'static str, &'static str)> {
    let (prefix, action) = value.split_once('.')?;
    let entity = match prefix {
        "cards" => "card",
        "cardContents" => "cardContent",
        "whiteboards" => "whiteboard",
        "items" => "boardItem",
        "records" => "canvasRecord",
        "tldrawDocuments" => "tldrawDocument",
        "files" => "file",
        "fileReferences" => "fileReference",
        "cardReferences" => "cardReference",
        "whiteboardReferences" => "whiteboardReference",
        "cardRelations" => "cardRelation",
        "conflicts" => "conflict",
        "todos" => "todo",
        _ => return None,
    };
    match action {
        "create" | "put" | "update" | "upsert" => Some((entity, "upsert")),
        "delete" => Some((entity, "delete")),
        _ => None,
    }
}

fn normalize_legacy_batch_operations(batch: &mut Value) -> bool {
    let Some(changes) = batch.get_mut("changes").and_then(Value::as_array_mut) else {
        return false;
    };
    let mut changed = false;
    for change in changes {
        let Some(operation) = change.get("operation").and_then(Value::as_str) else {
            continue;
        };
        if matches!(operation, "create" | "put" | "update") {
            change["operation"] = json!("upsert");
            changed = true;
        }
    }
    changed
}

fn validate_operation_label(value: &str) -> Result<(), StorageError> {
    if value.is_empty() || value.len() > 64 {
        return Err(StorageError::Invalid("Invalid command type".into()));
    }
    let (prefix, action) = value
        .split_once('.')
        .ok_or_else(|| StorageError::Invalid("Invalid command type".into()))?;
    let valid_part = |part: &str| {
        let mut chars = part.chars();
        chars.next().is_some_and(|first| first.is_ascii_lowercase())
            && chars.all(|character| character.is_ascii_alphanumeric())
    };
    if !valid_part(prefix) || !valid_part(action) || action.contains('.') {
        return Err(StorageError::Invalid("Invalid command type".into()));
    }
    Ok(())
}

fn validate_id(value: &str, name: &str) -> Result<(), StorageError> {
    if value.is_empty()
        || value.len() > 256
        || !value
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ":._-".contains(c))
    {
        return Err(StorageError::Invalid(format!("{name} is invalid")));
    }
    Ok(())
}
fn validate_setting_key(value: &str) -> Result<(), StorageError> {
    if !matches!(
        value,
        "workspaceId" | "agentBridgeEnabled" | "agentBridgePort"
    ) {
        return Err(StorageError::Invalid("Unknown setting".into()));
    }
    Ok(())
}
fn validate_hash(value: &str) -> Result<(), StorageError> {
    if value.len() != 64
        || !value
            .chars()
            .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
    {
        return Err(StorageError::Invalid("hash is invalid".into()));
    }
    Ok(())
}
fn validate_cursor(value: &str) -> Result<(), StorageError> {
    if value.parse::<u64>().is_err() {
        return Err(StorageError::Invalid("cursor is invalid".into()));
    }
    Ok(())
}
fn validate_batch(value: &Value, workspace: &str) -> Result<(), StorageError> {
    if value["protocolVersion"] != 1
        || value["schemaVersion"] != 2
        || value["workspaceId"] != workspace
    {
        return Err(StorageError::Invalid(
            "Invalid or mismatched change batch".into(),
        ));
    }
    validate_id(value["changeId"].as_str().unwrap_or(""), "changeId")?;
    let changes = value["changes"]
        .as_array()
        .ok_or_else(|| StorageError::Invalid("Invalid change list".into()))?;
    for change in changes {
        let entity_type = change["entityType"].as_str().unwrap_or("");
        if !entity_type_supported(entity_type) {
            return Err(StorageError::Invalid("Invalid entity type".into()));
        }
        validate_id(change["entityId"].as_str().unwrap_or(""), "entityId")?;
        if change["revision"].as_i64().is_none_or(|v| v < 1)
            || !matches!(change["operation"].as_str(), Some("upsert" | "delete"))
        {
            return Err(StorageError::Invalid("Invalid entity change".into()));
        }
        validate_id(change["clock"].as_str().unwrap_or(""), "clock")?;
    }
    Ok(())
}
fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn sync_directory(path: &Path) -> Result<(), StorageError> {
    // Windows does not allow opening a directory through std::fs::File.
    // The blob file itself was already flushed before MoveFileEx/rename.
    #[cfg(not(windows))]
    File::open(path)?.sync_all()?;
    #[cfg(windows)]
    let _ = path;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const MERGE_CONFORMANCE: &str =
        include_str!("../../../../packages/sync-protocol/src/merge-conformance.json");

    fn storage() -> (tempfile::TempDir, Storage) {
        let dir = tempfile::tempdir().unwrap();
        let storage = Storage::open(dir.path()).unwrap();
        (dir, storage)
    }

    #[test]
    fn consumes_shared_merge_conformance_fixtures() {
        let fixtures: Value = serde_json::from_str(MERGE_CONFORMANCE).unwrap();
        for fixture in fixtures["deterministicIds"].as_array().unwrap() {
            let parts = fixture["parts"]
                .as_array()
                .unwrap()
                .iter()
                .map(|part| part.as_str().unwrap())
                .collect::<Vec<_>>();
            let actual = if fixture["kind"] == "conflictCopyCard" {
                conflict_copy_card_id(parts[0])
            } else {
                deterministic_entity_id(fixture["namespace"].as_str().unwrap(), &parts)
            };
            assert_eq!(actual, fixture["expected"]);
        }
        assert_eq!(fixtures["scenarios"].as_array().unwrap().len(), 8);
    }

    #[test]
    fn sqlite_allowlist_exactly_matches_shared_entity_manifest() {
        let manifest: Value = serde_json::from_str(ENTITY_MANIFEST).unwrap();
        let entities = manifest["entities"].as_object().unwrap();
        let mut supported = HashSet::new();
        for (entity_type, definition) in entities {
            let prefix = definition["operationPrefix"].as_str().unwrap();
            let (listed_entity, mode) = query_operation(&format!("{prefix}.list")).unwrap();
            assert_eq!(listed_entity, entity_type);
            assert_eq!(mode, "list");
            supported.insert(listed_entity);
        }
        assert_eq!(supported.len(), entities.len());
    }

    #[test]
    fn local_mutation_is_persisted_with_batch_and_workspace_isolated() {
        let (dir, store) = storage();
        store
            .execute(
                "one",
                &json!({"type":"cards.create","input":{"id":"card-1","title":"Saved"}}),
            )
            .unwrap();
        let pending = store.pending("one", 10).unwrap();
        assert_eq!(pending.as_array().unwrap().len(), 1);
        assert_eq!(pending[0]["changes"][0]["operation"], "upsert");
        assert_eq!(
            store
                .query("two", &json!({"type":"cards.list","input":{}}))
                .unwrap(),
            json!([])
        );
        drop(store);
        let reopened = Storage::open(dir.path()).unwrap();
        assert_eq!(
            reopened
                .query("one", &json!({"type":"cards.get","input":{"id":"card-1"}}))
                .unwrap()["title"],
            "Saved"
        );
    }

    #[test]
    fn list_queries_filter_by_whiteboard_ids_and_tombstones() {
        let (_dir, store) = storage();
        store
            .execute(
                "one",
                &json!({
                    "type": "filter.seed",
                    "input": {"writes": [
                        {"entity":"boardItem","operation":"upsert","id":"item-a","value":{"whiteboardId":"board-a"}},
                        {"entity":"boardItem","operation":"upsert","id":"item-b","value":{"whiteboardId":"board-b"}},
                        {"entity":"boardItem","operation":"upsert","id":"item-root","value":{"whiteboardId":null}},
                        {"entity":"card","operation":"upsert","id":"card-a","value":{"title":"A"}},
                        {"entity":"card","operation":"upsert","id":"card-b","value":{"title":"B"}},
                        {"entity":"cardContent","operation":"upsert","id":"content-a","value":{"cardId":"card-a","document":{"type":"doc"}}},
                        {"entity":"cardContent","operation":"upsert","id":"content-b","value":{"cardId":"card-b","document":{"type":"doc"}}}
                    ]}
                }),
            )
            .unwrap();
        store
            .execute(
                "one",
                &json!({
                    "type": "filter.delete",
                    "input": {"writes": [{"entity":"boardItem","operation":"delete","id":"item-b","expectedRevision":1}]}
                }),
            )
            .unwrap();

        assert_eq!(
            store
                .query(
                    "one",
                    &json!({"type":"items.list","input":{"whiteboardId":"board-a"}}),
                )
                .unwrap()
                .as_array()
                .unwrap()
                .iter()
                .map(|row| row["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["item-a"]
        );
        assert_eq!(
            store
                .query(
                    "one",
                    &json!({"type":"items.list","input":{"whiteboardId":null}}),
                )
                .unwrap()
                .as_array()
                .unwrap()
                .iter()
                .map(|row| row["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["item-root"]
        );
        assert_eq!(
            store
                .query(
                    "one",
                    &json!({"type":"cards.list","input":{"ids":["card-b","missing","card-a","card-a"]}}),
                )
                .unwrap()
                .as_array()
                .unwrap()
                .iter()
                .map(|row| row["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["card-a", "card-b"]
        );
        assert_eq!(
            store
                .query("one", &json!({"type":"cards.list","input":{"ids":[]}}))
                .unwrap(),
            json!([])
        );
        assert_eq!(
            store
                .query(
                    "one",
                    &json!({"type":"cardContents.list","input":{"cardIds":["card-b"]}}),
                )
                .unwrap()
                .as_array()
                .unwrap()
                .iter()
                .map(|row| row["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["content-b"]
        );
        let large_ids = (0..1_100)
            .map(|index| Value::String(format!("missing-{index}")))
            .chain(std::iter::once(Value::String("card-a".into())))
            .collect::<Vec<_>>();
        assert_eq!(
            store
                .query(
                    "one",
                    &json!({"type":"cards.list","input":{"ids":large_ids}}),
                )
                .unwrap()
                .as_array()
                .unwrap()
                .iter()
                .map(|row| row["id"].as_str().unwrap())
                .collect::<Vec<_>>(),
            vec!["card-a"]
        );
        assert!(store
            .query(
                "one",
                &json!({"type":"cards.list","input":{"whiteboardId":"board-a"}}),
            )
            .is_err());
        assert!(store
            .query("one", &json!({"type":"items.list","input":[]}))
            .is_err());
    }

    #[test]
    fn duplicate_remote_batch_is_idempotent_and_cursor_is_atomic() {
        let (_dir, store) = storage();
        let batch = json!({"protocolVersion":1,"schemaVersion":2,"changeId":"remote-1","workspaceId":"one","deviceId":"remote","deviceSequence":1,"clock":"0000000000001:000000:remote","command":"cards.create","createdAt":1,"changes":[{"entityType":"card","entityId":"card-1","baseRevision":null,"revision":1,"operation":"upsert","clock":"0000000000001:000000:remote","value":{"id":"card-1","title":"Remote","revision":1}}]});
        assert_eq!(
            store
                .apply_remote("one", &json!([batch.clone()]), "cloud", "1")
                .unwrap()["applied"],
            1
        );
        assert_eq!(
            store
                .apply_remote("one", &json!([batch]), "cloud", "2")
                .unwrap()["applied"],
            0
        );
        assert_eq!(store.sync_state("one", "cloud").unwrap()["cursor"], "2");
    }

    #[test]
    fn remote_card_revision_and_hierarchy_conflicts_are_materialized() {
        let (_dir, store) = storage();
        store
            .execute(
                "one",
                &json!({"type":"cards.create","input":{"writes":[{
                    "entity":"card","operation":"upsert","id":"card-1",
                    "value":{"derivedTitle":"Local","content":null}
                }]}}),
            )
            .unwrap();
        let card_batch = json!({
            "protocolVersion":1,"schemaVersion":2,"changeId":"remote-card-conflict",
            "workspaceId":"one","deviceId":"remote","deviceSequence":1,
            "clock":"0000000000002:000000:remote","command":"cards.update","createdAt":2,
            "changes":[{"entityType":"card","entityId":"card-1","baseRevision":0,
                "revision":2,"operation":"upsert","clock":"0000000000002:000000:remote",
                "value":{"id":"card-1","derivedTitle":"Remote","content":null,"revision":2}}]
        });
        let result = store
            .apply_remote("one", &json!([card_batch]), "cloud", "1")
            .unwrap();
        assert_eq!(result["applied"], 0);
        assert_eq!(result["conflicts"], 1);
        assert_eq!(
            store
                .query("one", &json!({"type":"conflicts.list","input":{}}))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        assert_eq!(
            store
                .query("one", &json!({"type":"cards.list","input":{}}))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            2
        );

        let hierarchy_batch = json!({
            "protocolVersion":1,"schemaVersion":2,"changeId":"remote-hierarchy-conflict",
            "workspaceId":"one","deviceId":"remote","deviceSequence":2,
            "clock":"0000000000003:000000:remote","command":"whiteboards.create","createdAt":3,
            "changes":[{"entityType":"whiteboard","entityId":"board-1","baseRevision":null,
                "revision":1,"operation":"upsert","clock":"0000000000003:000000:remote",
                "value":{"id":"board-1","title":"Orphan","parentWhiteboardId":"missing"}}]
        });
        let result = store
            .apply_remote("one", &json!([hierarchy_batch]), "cloud", "2")
            .unwrap();
        assert_eq!(result["conflicts"], 1);
        assert!(store
            .query(
                "one",
                &json!({"type":"whiteboards.get","input":{"id":"board-1"}})
            )
            .unwrap()
            .is_null());
    }

    #[test]
    fn blob_is_atomic_verified_owned_and_recoverable() {
        let (dir, store) = storage();
        let bytes = b"hello";
        let hash = hex::encode(Sha256::digest(bytes));
        let descriptor = BlobDescriptor {
            hash: hash.clone(),
            content_type: "text/plain".into(),
            size: 5,
        };
        store.store_blob("one", &descriptor, bytes).unwrap();
        store.store_blob("one", &descriptor, bytes).unwrap();
        assert!(store.read_blob("two", &hash).unwrap().is_none());
        assert_eq!(store.read_blob("one", &hash).unwrap().unwrap().1, bytes);
        let bad = BlobDescriptor {
            hash: "a".repeat(64),
            ..descriptor
        };
        assert!(store.store_blob("one", &bad, bytes).is_err());
        fs::write(dir.path().join("tmp").join("stale.tmp"), b"x").unwrap();
        assert_eq!(store.recover().unwrap().stale_temps_removed, 1);
    }

    #[test]
    fn transaction_failure_leaves_no_partial_entity_or_batch() {
        let (_dir, store) = storage();
        let mut connection = store.connection.lock().unwrap();
        let result: Result<(), StorageError> = (|| {
            let transaction = connection.transaction()?;
            ensure_workspace(&transaction, "one")?;
            transaction.execute(
                "INSERT INTO entities(workspace_id,entity_type,entity_id,value_json,revision,clock,deleted)
                 VALUES('one','card','partial','{}',1,'0000000000001:000000:test',0)",
                [],
            )?;
            transaction.execute(
                "INSERT INTO pending_batches(workspace_id,change_id,created_at,batch_json,valid)
                 VALUES('one','partial',1,'{}',1)",
                [],
            )?;
            Err(StorageError::Invalid("injected failure".into()))
        })();
        assert!(result.is_err());
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM entities", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM pending_batches", [], |row| row
                    .get::<_, i64>(0))
                .unwrap(),
            0
        );
    }

    #[test]
    fn multi_write_tombstones_preserve_entity_payloads() {
        let (_dir, store) = storage();
        store
            .execute(
                "one",
                &json!({
                    "type": "whiteboards.create",
                    "input": {"value": {
                        "id": "board-delete",
                        "title": "Keep this in the tombstone",
                        "parentWhiteboardId": null
                    }}
                }),
            )
            .unwrap();

        store
            .execute(
                "one",
                &json!({
                    "type": "whiteboards.archiveTree",
                    "input": {"writes": [{
                        "entity": "whiteboard",
                        "operation": "delete",
                        "id": "board-delete",
                        "expectedRevision": 1
                    }]}
                }),
            )
            .unwrap();

        let connection = store.connection.lock().unwrap();
        let (value, deleted): (String, bool) = connection
            .query_row(
                "SELECT value_json, deleted FROM entities WHERE workspace_id='one' AND entity_type='whiteboard' AND entity_id='board-delete'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        let value: Value = serde_json::from_str(&value).unwrap();
        assert_eq!(value["title"], "Keep this in the tombstone");
        assert!(deleted);

        let pending = connection
            .query_row(
                "SELECT batch_json FROM pending_batches WHERE workspace_id='one' ORDER BY created_at DESC LIMIT 1",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        let pending: Value = serde_json::from_str(&pending).unwrap();
        assert_eq!(
            pending["changes"][0]["value"]["title"],
            "Keep this in the tombstone"
        );
    }

    #[test]
    fn multi_write_cascade_supports_all_entity_types_in_one_batch() {
        let (_dir, store) = storage();
        store
            .execute(
                "one",
                &json!({
                    "type": "whiteboards.archiveTree",
                    "input": {"writes": [
                        {"entity":"whiteboard","operation":"upsert","id":"cascade-board","value":{"parentWhiteboardId":null}},
                        {"entity":"boardItem","operation":"upsert","id":"cascade-item","value":{"whiteboardId":"cascade-board"}},
                        {"entity":"card","operation":"upsert","id":"cascade-card","value":{"activePlacementCount":1}},
                        {"entity":"tldrawDocument","operation":"upsert","id":"cascade-document","value":{"whiteboardId":"cascade-board"}},
                        {"entity":"canvasRecord","operation":"upsert","id":"cascade-record","value":{"whiteboardId":"cascade-board"}},
                        {"entity":"file","operation":"upsert","id":"cascade-file","value":{"sha256":"cascade-file-hash"}},
                        {"entity":"fileReference","operation":"upsert","id":"cascade-file-reference","value":{"fileId":"cascade-file","targetKey":"tldrawDocument:cascade-document"}},
                        {"entity":"cardReference","operation":"upsert","id":"cascade-card-reference","value":{"sourceCardId":"cascade-card","targetCardId":"other"}},
                        {"entity":"cardRelation","operation":"upsert","id":"cascade-relation","value":{"whiteboardId":"cascade-board"}}
                    ]}
                }),
            )
            .unwrap();

        let pending = store.pending("one", 10).unwrap();
        let changes = pending[0]["changes"].as_array().unwrap();
        let entity_types = changes
            .iter()
            .map(|change| change["entityType"].as_str().unwrap())
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(changes.len(), 9);
        assert_eq!(entity_types.len(), 9);
        assert!(changes.iter().all(|change| change["revision"] == 1));
    }

    #[test]
    fn a_revision_conflict_rolls_back_every_cascade_write() {
        let (_dir, store) = storage();
        store
            .execute(
                "one",
                &json!({"type":"cards.create","input":{"id":"existing-card"}}),
            )
            .unwrap();
        let before = store.pending("one", 10).unwrap();

        let result = store.execute(
            "one",
            &json!({"type":"whiteboards.archiveTree","input":{"writes":[
                {"entity":"boardItem","operation":"upsert","id":"must-not-persist","value":{}},
                {"entity":"card","operation":"upsert","id":"existing-card","expectedRevision":0,"value":{}}
            ]}}),
        );
        assert!(
            matches!(result, Err(StorageError::Invalid(message)) if message.starts_with("CONFLICT:"))
        );
        assert_eq!(store.pending("one", 10).unwrap(), before);
        assert_eq!(
            store
                .query(
                    "one",
                    &json!({"type":"items.get","input":{"id":"must-not-persist"}})
                )
                .unwrap(),
            Value::Null
        );
    }

    #[test]
    fn settings_are_allowlisted_and_survive_reopen() {
        let (dir, store) = storage();
        assert!(store.setting("workspaceId").unwrap().is_none());
        store.set_setting("workspaceId", "cloud-one").unwrap();
        assert!(store.set_setting("anything", "x").is_err());
        assert!(store.setting("anything").is_err());
        drop(store);
        let reopened = Storage::open(dir.path()).unwrap();
        assert_eq!(
            reopened.setting("workspaceId").unwrap().as_deref(),
            Some("cloud-one")
        );
    }

    #[test]
    fn adopt_moves_a_workspace_and_rewrites_pending_batches() {
        let (_dir, store) = storage();
        // The shared application services always emit the multi-write form, so
        // the adopted batches must stay valid for that shape.
        store
            .execute(
                "local",
                &json!({"type":"cards.put","input":{"writes":[
                    {"entity":"card","operation":"upsert","id":"card-1","value":{"title":"Saved"}}
                ]}}),
            )
            .unwrap();
        let bytes = b"hello";
        let hash = hex::encode(Sha256::digest(bytes));
        store
            .store_blob(
                "local",
                &BlobDescriptor {
                    hash: hash.clone(),
                    content_type: "text/plain".into(),
                    size: bytes.len() as u64,
                },
                bytes,
            )
            .unwrap();
        assert!(store.has_data("local").unwrap());
        assert!(!store.has_data("cloud").unwrap());
        store
            .apply_remote("local", &json!([]), "cloud", "42")
            .unwrap();
        assert_eq!(store.sync_state("local", "cloud").unwrap()["cursor"], "42");

        store.adopt_workspace("local", "cloud").unwrap();

        assert_eq!(
            store
                .query(
                    "cloud",
                    &json!({"type":"cards.get","input":{"id":"card-1"}})
                )
                .unwrap()["title"],
            "Saved"
        );
        assert_eq!(
            store
                .query("local", &json!({"type":"cards.list","input":{}}))
                .unwrap(),
            json!([])
        );
        assert!(store.read_blob("cloud", &hash).unwrap().is_some());
        assert_eq!(
            store.sync_state("cloud", "cloud").unwrap()["cursor"],
            Value::Null
        );
        let pending = store.pending("cloud", 10).unwrap();
        assert_eq!(pending.as_array().unwrap().len(), 1);
        assert_eq!(pending[0]["workspaceId"], "cloud");
        // A batch whose payload still named the old workspace would be rejected.
        assert!(validate_batch(&pending[0], "cloud").is_ok());
        // Adopting onto an occupied id must not merge two devices' histories.
        store
            .execute(
                "other",
                &json!({"type":"cards.put","input":{"writes":[
                    {"entity":"card","operation":"upsert","id":"card-2","value":{"title":"Other"}}
                ]}}),
            )
            .unwrap();
        assert!(store.adopt_workspace("other", "cloud").is_err());
        assert!(store.adopt_workspace("cloud", "cloud").is_ok());
    }

    #[test]
    fn merge_replays_entities_and_blobs_without_removing_source() {
        let (_dir, store) = storage();
        store
            .execute(
                "local",
                &json!({"type":"cards.put","input":{"writes":[
                    {"entity":"card","operation":"upsert","id":"card-1","value":{"title":"Local wins"}},
                    {"entity":"card","operation":"upsert","id":"card-local","value":{"title":"Only local"}}
                ]}}),
            )
            .unwrap();
        store
            .execute(
                "cloud",
                &json!({"type":"cards.put","input":{"writes":[
                    {"entity":"card","operation":"upsert","id":"card-1","value":{"title":"Cloud copy"}},
                    {"entity":"card","operation":"upsert","id":"card-cloud","value":{"title":"Only cloud"}}
                ]}}),
            )
            .unwrap();
        let bytes = b"merge me";
        let hash = hex::encode(Sha256::digest(bytes));
        store
            .store_blob(
                "local",
                &BlobDescriptor {
                    hash: hash.clone(),
                    content_type: "text/plain".into(),
                    size: bytes.len() as u64,
                },
                bytes,
            )
            .unwrap();

        assert_eq!(
            store.list_local_workspaces().unwrap(),
            vec!["cloud".to_owned(), "local".to_owned()]
        );
        assert_eq!(
            store.merge_workspace("local", "cloud").unwrap(),
            json!({"entities":2,"batches":1})
        );
        assert_eq!(
            store
                .query(
                    "local",
                    &json!({"type":"cards.get","input":{"id":"card-1"}})
                )
                .unwrap()["title"],
            "Local wins"
        );
        assert_eq!(
            store
                .query(
                    "cloud",
                    &json!({"type":"cards.get","input":{"id":"card-1"}})
                )
                .unwrap()["title"],
            "Local wins"
        );
        assert_eq!(
            store
                .query("cloud", &json!({"type":"cards.list","input":{}}))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            3
        );
        assert!(store.read_blob("cloud", &hash).unwrap().is_some());

        let pending = store.pending("cloud", 10).unwrap();
        for batch in pending.as_array().unwrap() {
            assert_eq!(batch["workspaceId"], "cloud");
            assert!(validate_batch(batch, "cloud").is_ok());
        }

        // Replaying the same source is safe: the source remains intact and the
        // target still has one materialized row per entity.
        assert_eq!(
            store.merge_workspace("local", "cloud").unwrap(),
            json!({"entities":2,"batches":1})
        );
        assert_eq!(
            store
                .query("cloud", &json!({"type":"cards.list","input":{}}))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            3
        );
        assert!(store.has_data("local").unwrap());
    }

    #[test]
    fn delete_workspace_cascades_rows_and_only_removes_unshared_blobs() {
        let (dir, store) = storage();
        store
            .execute(
                "source",
                &json!({"type":"cards.put","input":{"writes":[
                    {"entity":"card","operation":"upsert","id":"source-card","value":{"title":"Discard me"}}
                ]}}),
            )
            .unwrap();
        store
            .apply_remote(
                "source",
                &json!([{
                    "protocolVersion": 1,
                    "schemaVersion": 2,
                    "changeId": "remote-source-change",
                    "workspaceId": "source",
                    "deviceId": "peer-device",
                    "deviceSequence": 1,
                    "clock": "0000000000001:000000:peer-device",
                    "command": "cards.create",
                    "createdAt": 1,
                    "changes": [{
                        "entityType": "card",
                        "entityId": "remote-source-card",
                        "baseRevision": null,
                        "revision": 1,
                        "operation": "upsert",
                        "clock": "0000000000001:000000:peer-device",
                        "value": {"id": "remote-source-card", "title": "Remote"}
                    }]
                }]),
                "peer",
                "12",
            )
            .unwrap();

        let shared_bytes = b"shared";
        let shared_hash = hex::encode(Sha256::digest(shared_bytes));
        let shared_descriptor = BlobDescriptor {
            hash: shared_hash.clone(),
            content_type: "text/plain".into(),
            size: shared_bytes.len() as u64,
        };
        store
            .store_blob("source", &shared_descriptor, shared_bytes)
            .unwrap();
        store
            .store_blob("target", &shared_descriptor, shared_bytes)
            .unwrap();

        let unique_bytes = b"source only";
        let unique_hash = hex::encode(Sha256::digest(unique_bytes));
        let unique_descriptor = BlobDescriptor {
            hash: unique_hash.clone(),
            content_type: "text/plain".into(),
            size: unique_bytes.len() as u64,
        };
        store
            .store_blob("source", &unique_descriptor, unique_bytes)
            .unwrap();
        let unique_path = dir.path().join("blobs").join(&unique_hash);
        assert!(unique_path.exists());

        store.set_setting("workspaceId", "target").unwrap();
        assert!(store.delete_workspace("target").is_err());

        store.delete_workspace("source").unwrap();
        // A second cleanup attempt is safe for callers retrying an already
        // completed destructive action.
        store.delete_workspace("source").unwrap();

        let connection = store.connection.lock().unwrap();
        for table in [
            "entities",
            "pending_batches",
            "applied_batches",
            "sync_peers",
            "workspace_blobs",
        ] {
            let count: i64 = connection
                .query_row(
                    &format!("SELECT count(*) FROM {table} WHERE workspace_id='source'"),
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(count, 0, "{table} should cascade for the deleted workspace");
        }
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM blobs WHERE hash=?1",
                    [&unique_hash],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row(
                    "SELECT count(*) FROM blobs WHERE hash=?1",
                    [&shared_hash],
                    |row| row.get::<_, i64>(0),
                )
                .unwrap(),
            1
        );
        drop(connection);

        assert!(!unique_path.exists());
        assert!(dir.path().join("blobs").join(&shared_hash).exists());
        assert!(store.read_blob("target", &shared_hash).unwrap().is_some());
        assert!(!store
            .list_local_workspaces()
            .unwrap()
            .contains(&"source".into()));
    }

    #[test]
    fn recovery_is_repeatable_for_missing_orphan_and_invalid_pending_state() {
        let (dir, store) = storage();
        let bytes = b"valid";
        let hash = hex::encode(Sha256::digest(bytes));
        let descriptor = BlobDescriptor {
            hash: hash.clone(),
            content_type: "text/plain".into(),
            size: bytes.len() as u64,
        };
        store.store_blob("one", &descriptor, bytes).unwrap();
        fs::remove_file(dir.path().join("blobs").join(&hash)).unwrap();
        fs::write(dir.path().join("blobs").join("orphan"), b"x").unwrap();
        {
            let connection = store.connection.lock().unwrap();
            connection.execute(
                "INSERT INTO pending_batches(workspace_id,change_id,created_at,batch_json,valid)
                 VALUES('one','invalid',1,'{}',1)",
                [],
            ).unwrap();
        }
        let first = store.recover().unwrap();
        assert_eq!(first.missing_blobs_marked, 1);
        assert_eq!(first.orphan_blobs_removed, 1);
        assert_eq!(first.invalid_pending_removed, 1);
        let second = store.recover().unwrap();
        assert_eq!(second.missing_blobs_marked, 0);
        assert_eq!(second.orphan_blobs_removed, 0);
        assert_eq!(second.invalid_pending_removed, 0);
        assert_eq!(store.missing_blobs("one").unwrap(), vec![descriptor]);
    }

    #[test]
    fn recovery_normalizes_legacy_pending_operations_before_removing_invalid_batches() {
        let (dir, store) = storage();
        store
            .execute(
                "one",
                &json!({"type":"cards.create","input":{"id":"card-legacy","title":"Saved"}}),
            )
            .unwrap();
        {
            let connection = store.connection.lock().unwrap();
            let batch_json: String = connection
                .query_row(
                    "SELECT batch_json FROM pending_batches WHERE workspace_id='one'",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            let mut batch: Value = serde_json::from_str(&batch_json).unwrap();
            batch["changes"][0]["operation"] = json!("update");
            connection
                .execute(
                    "UPDATE pending_batches SET batch_json=?1 WHERE workspace_id='one'",
                    [serde_json::to_string(&batch).unwrap()],
                )
                .unwrap();
        }

        drop(store);
        let reopened = Storage::open(dir.path()).unwrap();
        let pending = reopened.pending("one", 10).unwrap();
        assert_eq!(pending.as_array().unwrap().len(), 1);
        assert_eq!(pending[0]["changes"][0]["operation"], "upsert");
    }
}
