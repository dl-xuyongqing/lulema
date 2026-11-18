import {mkdir,cp,writeFile} from "node:fs/promises";
import {resolve} from "node:path";
const root=resolve(import.meta.dirname,"..");
const out=resolve(root,"artifacts/site");
await mkdir(out,{recursive:true});
for(const file of ["index.html","styles.css","config.js","manifest.webmanifest","sw.js","src","assets"])await cp(resolve(root,file),resolve(out,file),{recursive:true});
await writeFile(resolve(out,".nojekyll"),"");
console.log("Static website ready: artifacts/site");
