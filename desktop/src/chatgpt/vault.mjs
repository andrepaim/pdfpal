import fs from 'node:fs/promises'
import path from 'node:path'
export function protectedVault(directory,storage){
 const filename=path.join(directory,'accounts.enc')
 return {
  async read(){try{return JSON.parse((await storage.decryptStringAsync(await fs.readFile(filename))).result)}catch(e){if(e.code==='ENOENT')return null;throw Error('The ChatGPT connection could not be unlocked. Reconnect from AI settings.')}},
  async write(value){if(!await storage.isAsyncEncryptionAvailable())throw Error('Windows credential protection is unavailable.');await fs.mkdir(directory,{recursive:true,mode:0o700});const temp=filename+'.tmp';await fs.writeFile(temp,await storage.encryptStringAsync(JSON.stringify(value)),{mode:0o600});await fs.rename(temp,filename)}
 }
}
