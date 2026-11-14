import {test} from 'node:test'
import assert from 'node:assert/strict'
import {protectedVault} from '../src/chatgpt/vault.mjs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
test('vault fails closed when OS protection is unavailable',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pdfpal-vault-'));try{const v=protectedVault(dir,{isAsyncEncryptionAvailable:async()=>false});await assert.rejects(v.write({access_token:'secret'}),/unavailable/);assert.deepEqual(await fs.readdir(dir),[])}finally{await fs.rm(dir,{recursive:true,force:true})}})
test('vault errors name the platform credential store, never Windows on a Mac',async()=>{const storage={isAsyncEncryptionAvailable:async()=>false};await assert.rejects(protectedVault('/nonexistent',storage,'darwin').write({}),error=>/Keychain/.test(error.message)&&!/Windows/.test(error.message));await assert.rejects(protectedVault('/nonexistent',storage,'win32').write({}),{message:'Windows credential protection is unavailable.'})})
