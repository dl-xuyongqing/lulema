import {deflateSync} from "node:zlib";
import {writeFile,mkdir} from "node:fs/promises";
import {resolve} from "node:path";
function crc32(data){let c=0xffffffff;for(const b of data){c^=b;for(let i=0;i<8;i++)c=(c>>>1)^((c&1)?0xedb88320:0);}return(c^0xffffffff)>>>0;}
function chunk(type,data){const name=Buffer.from(type),len=Buffer.alloc(4),crc=Buffer.alloc(4);len.writeUInt32BE(data.length);crc.writeUInt32BE(crc32(Buffer.concat([name,data])));return Buffer.concat([len,name,data,crc]);}
function curve(a,b,c,d){return Array.from({length:51},(_,i)=>{const t=i/50,u=1-t;return [u*u*u*a[0]+3*u*u*t*b[0]+3*u*t*t*c[0]+t*t*t*d[0],u*u*u*a[1]+3*u*u*t*b[1]+3*u*t*t*c[1]+t*t*t*d[1]];});}
const leaf=[...curve([147,45],[147,112],[120,144],[80,144]),...curve([80,144],[57,144],[40,127],[40,104]),...curve([40,104],[40,64],[80,45],[147,45])];
function inside(x,y){let hit=false;for(let i=0,j=leaf.length-1;i<leaf.length;j=i++){const a=leaf[i],b=leaf[j];if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])hit=!hit;}return hit;}
function near(x,y,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));return Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)<4;}
const stems=[[[43,150],[106,86]],[[72,122],[72,91]],[[72,122],[104,122]]];
const dark=[41,77,63],light=[217,231,201];
const dir=resolve(import.meta.dirname,"../assets");await mkdir(dir,{recursive:true});
for(const size of [192,512]){
  const data=Buffer.alloc(size*(size*4+1));
  for(let y=0;y<size;y++){const offset=y*(size*4+1);data[offset]=0;for(let x=0;x<size;x++){const result=[0,0,0];for(let sy=0;sy<2;sy++)for(let sx=0;sx<2;sx++){const px=(x+(sx+.5)/2)*192/size,py=(y+(sy+.5)/2)*192/size;const color=inside(px,py)&&!stems.some(([a,b])=>near(px,py,a,b))?light:dark;for(let k=0;k<3;k++)result[k]+=color[k]/4;}const i=offset+1+x*4;for(let k=0;k<3;k++)data[i+k]=Math.round(result[k]);data[i+3]=255;}}
  const header=Buffer.alloc(13);header.writeUInt32BE(size,0);header.writeUInt32BE(size,4);header[8]=8;header[9]=6;
  await writeFile(resolve(dir,`icon-${size}.png`),Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]),chunk("IHDR",header),chunk("IDAT",deflateSync(data)),chunk("IEND",Buffer.alloc(0))]));
}
console.log("PWA icons generated");
