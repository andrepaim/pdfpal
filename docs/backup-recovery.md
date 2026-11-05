# Library backups and recovery

Open **Backups** at the lower left of pdfpal. Backups are local and work without Google sign-in, a server account, or Firebase billing.

## Save and move a full library

**Back up now** saves the database and managed PDF files together. This includes notes, highlights, saved conversations, extracted text, interactive visual definitions, Kindle history and Recently deleted entries. It excludes your Google refresh token, ChatGPT account credentials, and machine configuration. Backups contain your private research and conversations; protect the backup folder accordingly. They are not encrypted by pdfpal.

Automatic backups default to daily while pdfpal is open. Choose every six hours, daily or weekly, and keep 2–30 scheduled copies (default seven). Manual copies and safety copies made before recovery are kept until you remove them. The two newest complete scheduled copies are preserved even when newer scheduled copies are partial.

On Windows, **Choose folder** lets you use an external drive or a folder you manage yourself. pdfpal creates a `pdfpal-library-backups` subfolder. You can copy that subfolder to another computer and select its parent folder there. Existing backup locations remain discoverable after changing the save folder. The default is `<library>/backups/libraries`.

Each saved copy is a directory named `backup-<UUID>` with a manifest, a SQLite database and a `files` directory. Keep these together. Creation uses a staged directory, a consistent online SQLite snapshot, a file-write lease, database integrity checks, and SHA-256 hashes. Incomplete staged directories never appear as saved copies. **Verify** checks the saved bytes again. If an old library has missing PDFs, the copy is labelled partial; its available data is still recoverable.

## Recover without replacing current work

**Open recovery copy** verifies a backup, first saves a safety copy of the current library, and prepares a separate recovered library. On Windows, pdfpal restarts into that library. Open **Backups → Open library → Original library** to return. The original database and papers are kept in place.

Recovered libraries start with cloud synchronization, cloud error sharing and scheduled backups off. Old sync operations and cloud bindings are cleared; they cannot replay into your current cloud library. Interrupted AI jobs are marked interrupted and are never automatically resent. Saved extension history stays readable, but the extension must pair again before writing to a recovered library. Google and AI accounts remain in the native Windows profile; choosing a provider for a recovered library does not copy credentials into a backup.

The browser interface can prepare recovery copies but cannot restart a separately launched CLI server. It displays the recovered directory. Start it with `pdfpal serve --data-dir "/path/to/recovered-library" --port 8203`. Quit that server when finished; your original server stays independent. Native Windows switching is available from the installed desktop app.

## Undo deletions

**Recently deleted** keeps up to 100 deletion entries for 30 days. Deleting a project records its child content in the same database transaction. Source files remain retained so Undo can restore them. Synced deletions are journaled on other updated devices too; a deletion spanning multiple sync pages cannot be restored until its last operation arrives.

**Restore** reuses the original identities and refuses to replace current records. **Restore a copy** assigns new identities. If a project or discussion needed by the deleted item was removed later, restore its parent first. Newer filing decisions are preserved when restoring links. Missing or damaged retained PDF files are reported; readable text and metadata can still be restored.

**Remove entry** removes the recovery entry. It does not erase copies in backups, remove retained orphan PDF files, or securely wipe disk sectors. Removing a backup deletes only that saved directory. Account credentials and existing cloud data are independent of these actions.
