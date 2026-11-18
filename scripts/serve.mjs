import {createServer} from "node:http";
import {readFile} from "node:fs/promises";
import {resolve,extname,sep} from "node:path";
const root=resolve(import.meta.dirname,"..");
const types={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".svg":"image/svg+xml",".png":"image/png",".webmanifest":"application/manifest+json"};
const server=createServer(async(req,res)=>{
  let pathname;
  try {pathname=decodeURIComponent(new URL(req.url,"http://localhost").pathname);}catch{res.writeHead(400).end();return;}
  if(pathname==="/lulema"){res.writeHead(302,{Location:"/lulema/"}).end();return;}
  const localPath=pathname.startsWith("/lulema/")?pathname.slice(7):pathname;
  const file=resolve(root,"."+(localPath.endsWith("/")?localPath+"index.html":localPath));
  if(!file.startsWith(root+sep)||!types[extname(file)]||file.includes(`${sep}worker${sep}`)||file.includes(`${sep}artifacts${sep}`)){res.writeHead(404).end();return;}
  try{const data=await readFile(file);res.writeHead(200,{"Content-Type":types[extname(file)],"Cache-Control":"no-store"});res.end(data);}catch{res.writeHead(404).end("Not found");}
});
server.listen(4173,"127.0.0.1",()=>console.log("Lulema: http://127.0.0.1:4173/lulema/"));
