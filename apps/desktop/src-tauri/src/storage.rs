use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File},
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::Mutex,
    time::{SystemTime, UNIX_EPOCH},
};
use uuid::Uuid;

const SCHEMA_VERSION: i64 = 1;
const ENTITY_TYPES: &[&str] = &[
    "whiteboard",
    "card",
    "boardItem",
    "tldrawDocument",
    "file",
    "fileReference",
    "cardReference",
    "cardRelation",
    "canvasRecord",
    "conflict",
    "todo",
];

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
        let input = request.get("input").and_then(Value::as_object);
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
        let mut statement = connection.prepare(
            "SELECT value_json FROM entities WHERE workspace_id=?1 AND entity_type=?2 AND deleted=0 ORDER BY entity_id"
        )?;
        let rows = statement.query_map(params![workspace, entity_type], |row| {
            row.get::<_, String>(0)
        })?;
        let values = rows
            .map(|row| serde_json::from_str(&row?).map_err(StorageError::from))
            .collect::<Result<Vec<Value>, StorageError>>()?;
        Ok(Value::Array(values))
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
                let values = values.as_array().ok_or_else(|| {
                    StorageError::Invalid("writes must be an array".into())
                })?;
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
                        if !ENTITY_TYPES.contains(&entity) {
                            return Err(StorageError::Invalid("Invalid entity type".into()));
                        }
                        let action = object
                            .get("operation")
                            .and_then(Value::as_str)
                            .ok_or_else(|| StorageError::Invalid("Invalid write operation".into()))?;
                        if action != "upsert" && action != "delete" {
                            return Err(StorageError::Invalid("Invalid write operation".into()));
                        }
                        let id = object
                            .get("id")
                            .and_then(Value::as_str)
                            .ok_or_else(|| {
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
                        let expected = object.get("expectedRevision").map(|revision| {
                            revision.as_i64().ok_or_else(|| {
                                StorageError::Invalid(
                                    "expectedRevision must be an integer".into(),
                                )
                            })
                        }).transpose()?;
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
                    .ok_or_else(|| {
                        StorageError::Invalid("A valid entity ID is required".into())
                    })?
                    .to_owned();
                validate_id(&id, "entityId")?;
                vec![(
                    entity.to_owned(),
                    action.to_owned(),
                    id,
                    Some(value),
                    None,
                )]
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
            materialized_values.into_iter().next().unwrap_or(Value::Null)
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
            for change in batch["changes"].as_array().unwrap() {
                let entity_type = change["entityType"].as_str().unwrap();
                let entity_id = change["entityId"].as_str().unwrap();
                let incoming_clock = change["clock"].as_str().unwrap();
                let local_clock: Option<String> = transaction.query_row(
                    "SELECT clock FROM entities WHERE workspace_id=?1 AND entity_type=?2 AND entity_id=?3",
                    params![workspace, entity_type, entity_id], |row| row.get(0),
                ).optional()?;
                if local_clock
                    .as_deref()
                    .is_some_and(|clock| clock > incoming_clock)
                {
                    continue;
                }
                merge_hlc(&transaction, workspace, incoming_clock)?;
                let deleted = change["operation"] == "delete";
                transaction.execute(
                    "INSERT INTO entities(workspace_id,entity_type,entity_id,value_json,revision,clock,deleted)
                     VALUES(?1,?2,?3,?4,?5,?6,?7)
                     ON CONFLICT(workspace_id,entity_type,entity_id) DO UPDATE SET
                     value_json=excluded.value_json,revision=excluded.revision,clock=excluded.clock,deleted=excluded.deleted",
                    params![workspace, entity_type, entity_id, serde_json::to_string(&change["value"])?,
                        change["revision"].as_i64().unwrap(), incoming_clock, deleted],
                )?;
                applied += 1;
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
        Ok(json!({ "applied": applied, "conflicts": 0 }))
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
                json!({"peerId":peer,"cursor":cursor,"enabled":true,"updatedAt":updated,"lastSyncedAt":synced})
            }
            None => {
                json!({"peerId":peer,"cursor":null,"enabled":true,"updatedAt":now_ms(),"lastSyncedAt":null})
            }
        })
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
            let mut statement = transaction
                .prepare("SELECT change_id,batch_json FROM pending_batches WHERE workspace_id=?1")?;
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

fn migrate(connection: &Connection) -> Result<(), StorageError> {
    connection.execute_batch("BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS schema_meta(version INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS workspaces(id TEXT PRIMARY KEY, device_id TEXT NOT NULL, device_sequence INTEGER NOT NULL DEFAULT 0, hlc_millis INTEGER NOT NULL DEFAULT 0, hlc_counter INTEGER NOT NULL DEFAULT 0);
      CREATE TABLE IF NOT EXISTS entities(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, value_json TEXT NOT NULL, revision INTEGER NOT NULL, clock TEXT NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(workspace_id,entity_type,entity_id));
      CREATE TABLE IF NOT EXISTS pending_batches(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, change_id TEXT NOT NULL, created_at INTEGER NOT NULL, batch_json TEXT NOT NULL, valid INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(workspace_id,change_id));
      CREATE TABLE IF NOT EXISTS applied_batches(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, change_id TEXT NOT NULL, PRIMARY KEY(workspace_id,change_id));
      CREATE TABLE IF NOT EXISTS sync_peers(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, peer_id TEXT NOT NULL, cursor TEXT NOT NULL, updated_at INTEGER NOT NULL, last_synced_at INTEGER, PRIMARY KEY(workspace_id,peer_id));
      CREATE TABLE IF NOT EXISTS blobs(hash TEXT PRIMARY KEY,size INTEGER NOT NULL,content_type TEXT NOT NULL,present INTEGER NOT NULL DEFAULT 1);
      CREATE TABLE IF NOT EXISTS workspace_blobs(workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,hash TEXT NOT NULL REFERENCES blobs(hash) ON DELETE CASCADE,PRIMARY KEY(workspace_id,hash));
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY, value TEXT NOT NULL);
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
        Some(value) => {
            return Err(StorageError::Invalid(format!(
                "Unsupported schema version {value}"
            )))
        }
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
fn query_operation(value: &str) -> Option<(&'static str, &'static str)> {
    let (prefix, action) = value.split_once('.')?;
    let entity = match prefix {
        "cards" => "card",
        "whiteboards" => "whiteboard",
        "items" => "boardItem",
        "records" => "canvasRecord",
        "tldrawDocuments" => "tldrawDocument",
        "files" => "file",
        "fileReferences" => "fileReference",
        "cardReferences" => "cardReference",
        "cardRelations" => "cardRelation",
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
        "whiteboards" => "whiteboard",
        "items" => "boardItem",
        "records" => "canvasRecord",
        "tldrawDocuments" => "tldrawDocument",
        "files" => "file",
        "fileReferences" => "fileReference",
        "cardReferences" => "cardReference",
        "cardRelations" => "cardRelation",
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
    if value != "workspaceId" {
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
        if !ENTITY_TYPES.contains(&entity_type) {
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

    fn storage() -> (tempfile::TempDir, Storage) {
        let dir = tempfile::tempdir().unwrap();
        let storage = Storage::open(dir.path()).unwrap();
        (dir, storage)
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
                .query_row("SELECT count(*) FROM entities", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            0
        );
        assert_eq!(
            connection
                .query_row("SELECT count(*) FROM pending_batches", [], |row| row.get::<_, i64>(0))
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
                .query("cloud", &json!({"type":"cards.get","input":{"id":"card-1"}}))
                .unwrap()["title"],
            "Saved"
        );
        assert_eq!(
            store.query("local", &json!({"type":"cards.list","input":{}})).unwrap(),
            json!([])
        );
        assert!(store.read_blob("cloud", &hash).unwrap().is_some());
        assert_eq!(store.sync_state("cloud", "cloud").unwrap()["cursor"], Value::Null);
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
