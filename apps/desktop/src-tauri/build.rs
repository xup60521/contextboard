fn main() {
    println!("cargo:rerun-if-changed=../../../skills/contextboard/SKILL.md");
    tauri_build::build()
}
