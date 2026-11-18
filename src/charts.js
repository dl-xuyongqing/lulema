import {chartStatistics} from "./model.js";

// 使用原生 SVG；离线也能查看，数值和日期均来自本机记录。
function columns(selector,values,labels,{recorded=null,label="",color="#b18a6b"}={}) {
  const svg=document.querySelector(selector),width=600,height=190,left=30,right=10,top=25,bottom=35;
  const plotWidth=width-left-right,plotHeight=height-top-bottom,max=Math.max(1,...values);
  const ceiling=max<=4?max:Math.ceil(max/5)*5,step=plotWidth/values.length,barWidth=Math.min(42,step*.62);
  const ticks=[0,Math.ceil(ceiling/2),ceiling].filter((n,i,a)=>a.indexOf(n)===i);
  let content=`<title>${label}</title>`;
  for(const tick of ticks){const y=top+plotHeight-tick/ceiling*plotHeight;content+=`<path d="M${left} ${y}H${width-right}" class="chart-gridline"/><text x="${left-8}" y="${y+4}" text-anchor="end" class="chart-axis">${tick}</text>`;}
  values.forEach((count,i)=>{
    const x=left+step*(i+.5),barHeight=count/ceiling*plotHeight,y=top+plotHeight-barHeight;
    const known=recorded===null||recorded[i],fill=count?color:known?"#99b27f":"#e9ece3";
    content+=`<rect x="${x-barWidth/2}" y="${count?y:top+plotHeight-3}" width="${barWidth}" height="${count?barHeight:3}" rx="${Math.min(4,barWidth/2)}" fill="${fill}"><title>${labels[i]}：${count} 次${known?"":"（未记录）"}</title></rect>`;
    if(values.length<=7)content+=`<text x="${x}" y="${count?y-7:top+plotHeight-9}" text-anchor="middle" class="chart-value">${count}</text>`;
    const interval=values.length<=7?1:Math.ceil(values.length/7);
    if(i%interval===0||i===values.length-1)content+=`<text x="${x}" y="${height-12}" text-anchor="middle" class="chart-axis">${labels[i]}</text>`;
  });
  svg.setAttribute("viewBox",`0 0 ${width} ${height}`);svg.innerHTML=content;
}

export function renderCharts(state,today,range=30) {
  const stats=chartStatistics(state,today,range);
  document.querySelector("#chart-summary").textContent=`近 ${range} 天 · 撸了 ${stats.total} 次 · ${stats.recordedDays} 天有记录`;
  document.querySelector("#daily-chart-caption").textContent=stats.recordedDays?"每根柱子代表当天次数；绿线为已记录且没撸，灰线为未记录。":"还没有记录。添加后，这里会展示每日次数。";
  columns("#daily-chart",stats.daily.map(d=>d.count),stats.daily.map(d=>`${Number(d.date.slice(5,7))}/${Number(d.date.slice(-2))}`),{recorded:stats.daily.map(d=>d.recorded),label:`近 ${range} 天每日撸了次数，总计 ${stats.total} 次`});
  const weekdays=["周一","周二","周三","周四","周五","周六","周日"];
  columns("#weekday-chart",stats.weekdays,weekdays,{label:`近 ${range} 天星期分布`,color:"#91a879"});
  columns("#period-chart",stats.periods,["00–06","06–12","12–18","18–24"],{label:`近 ${range} 天按当前设备本地时间统计的时段分布`,color:"#aaa0bb"});
  document.querySelector("#period-chart-caption").textContent="按当前设备本地时间统计“撸了”记录。";
  columns("#monthly-chart",stats.months.map(m=>m.count),stats.months.map(m=>`${Number(m.month.slice(-2))}月`),{label:"最近六个月撸了次数",color:"#b18a6b"});
  // 提供可展开的文本数据，便于键盘和屏幕阅读器读取。
  const body=document.querySelector("#chart-data");body.replaceChildren();
  for(const day of stats.daily){const row=document.createElement("tr");for(const value of [day.date,day.recorded?`${day.count} 次`:"未记录"]){const cell=document.createElement("td");cell.textContent=value;row.append(cell);}body.append(row);}
}
