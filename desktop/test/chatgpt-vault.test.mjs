import {test} from 'node:test'
import assert from 'node:assert/strict'
import {protectedVault} from '../src/chatgpt/vault.mjs'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
test('vault fails closed when OS protection is unavailable',async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pdfpal-vault-'));try{const v=protectedVault(dir,{isAsyncEncryptionAvailable:async()=>false});await assert.rejects(v.write({access_token:'secret'}),/unavailable/);assert.deepEqual(await fs.readdir(dir),[])}finally{await fs.rm(dir,{recursive:true,force:true})}})

async function fixture(run) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'pdfpal-vault-'))
 try { await run(dir) } finally { await fs.rm(dir,{recursive:true,force:true}) }
}
function storageMock(tag='v11') {
 return {
  isAsyncEncryptionAvailable:async()=>true,
  encryptStringAsync:async value=>Buffer.from(tag+Buffer.from(value).toString('base64')),
  decryptStringAsync:async value=>({result:Buffer.from(value.subarray(3).toString(),'base64').toString(),shouldReEncrypt:false}),
 }
}

test('Linux rejects asynchronous hardcoded fallback despite availability and a reassuring synchronous backend',async()=>fixture(async dir=>{
 for(const tag of ['v10','v20','xxx','']){
  const storage={...storageMock(tag),getSelectedStorageBackend:()=> 'gnome_libsecret'}
  const vault=protectedVault(dir,storage,{platform:'linux'})
  await assert.rejects(vault.write({access_token:'must never persist'}),/Secure credential storage is unavailable/)
  assert.deepEqual(await fs.readdir(dir),[])
 }
}))

test('Secret Service and portal credentials round trip with private files using the async API only',async()=>fixture(async dir=>{
 for(const tag of ['v11','v12']){
  const folder=path.join(dir,tag),vault=protectedVault(folder,storageMock(tag),{platform:'linux'}), value={accounts:[{access_token:'fixture-token',refresh_token:'fixture-refresh'}]}
  assert.equal(await vault.read(),null)
  await vault.write(value);assert.deepEqual(await vault.read(),value)
  const filename=path.join(folder,'accounts.enc'),encrypted=await fs.readFile(filename)
  assert.equal(encrypted.includes('fixture-token'),false)
  if(process.platform!=='win32'){
   assert.equal((await fs.stat(folder)).mode&0o777,0o700)
   assert.equal((await fs.stat(filename)).mode&0o777,0o600)
  }
  assert.deepEqual(await fs.readdir(folder),['accounts.enc'])
 }
}))

test('Linux refuses existing unprotected data and unavailable keyrings before decryption, preserving the file',async()=>fixture(async dir=>{
 const filename=path.join(dir,'accounts.enc'),original=Buffer.from('v10unprotected')
 await fs.writeFile(filename,original)
 let decryptions=0
 const storage={...storageMock(),decryptStringAsync:async()=>{decryptions++;return {result:'{}'}}}
 const vault=protectedVault(dir,storage,{platform:'linux'})
 await assert.rejects(vault.read(),/unavailable/);assert.equal(decryptions,0)
 await fs.writeFile(filename,Buffer.from('v11fixture'))
 storage.isAsyncEncryptionAvailable=async()=>false
 await assert.rejects(vault.read(),/unavailable/);assert.equal(decryptions,0)
 assert.equal((await fs.readFile(filename)).toString(),'v11fixture')
}))

test('Linux rechecks the actual secret encryption result after its nonsecret protection probe',async()=>fixture(async dir=>{
 let encryptions=0
 const storage={...storageMock(),encryptStringAsync:async()=>Buffer.from(++encryptions===1?'v11secure-probe':'v10fallback')}
 await assert.rejects(protectedVault(dir,storage,{platform:'linux'}).write({access_token:'fixture'}),/unavailable/)
 assert.deepEqual(await fs.readdir(dir),[])
}))

test('failed encryption and decryption preserve the last vault without plaintext or temporary files',async()=>fixture(async dir=>{
 const storage=storageMock(),vault=protectedVault(dir,storage,{platform:'linux'})
 await vault.write({access_token:'first-fixture'})
 const original=await fs.readFile(path.join(dir,'accounts.enc'))
 storage.encryptStringAsync=async()=>{throw Error('locked')}
 await assert.rejects(vault.write({access_token:'second-fixture'}),/locked/)
 assert.deepEqual(await fs.readFile(path.join(dir,'accounts.enc')),original)
 assert.deepEqual(await fs.readdir(dir),['accounts.enc'])
 storage.encryptStringAsync=storageMock().encryptStringAsync
 storage.decryptStringAsync=async()=>{throw Error('locked')}
 await assert.rejects(vault.read(),/could not be unlocked/)
 assert.deepEqual(await fs.readFile(path.join(dir,'accounts.enc')),original)
}))

test('key rotation rewrites protected credentials and Windows keeps its existing ciphertext format',async()=>fixture(async dir=>{
 const storage=storageMock(),vault=protectedVault(dir,storage,{platform:'linux'})
 await vault.write({access_token:'fixture'})
 storage.decryptStringAsync=async()=>({result:'{"access_token":"fixture"}',shouldReEncrypt:true})
 storage.encryptStringAsync=storageMock('v12').encryptStringAsync
 assert.deepEqual(await vault.read(),{access_token:'fixture'})
 assert.equal((await fs.readFile(path.join(dir,'accounts.enc'))).subarray(0,3).toString(),'v12')
 const windows=protectedVault(path.join(dir,'windows'),storageMock('v10'),{platform:'win32'})
 await windows.write({access_token:'windows-fixture'});assert.deepEqual(await windows.read(),{access_token:'windows-fixture'})
}))
