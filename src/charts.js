import {chartStatistics} from "./model.js";

// 原生 SVG 支持离线查看；统计起点之后没有事件的日期显示为零次。
function drawChart(points,{type,color,label,description}) {
  const svg=document.querySelector("#statistics-chart");
  const width=Math.max(280,Math.round(svg.getBoundingClientRect().width)||600),height=240,left=34,right=20,top=28,bottom=36;
  const plotWidth=width-left-right,plotHeight=height-top-bottom,max=Math.max(1,...points.map(p=>p.count));
  const ceiling=max<=4?max:Math.ceil(max/5)*5,step=plotWidth/points.length,barWidth=Math.min(42,step*.62);
  const ticks=[0,Math.ceil(ceiling/2),ceiling].filter((n,i,a)=>a.indexOf(n)===i);
  const position=(point,i)=>({x:left+step*(i+.5),y:top+plotHeight-point.count/ceiling*plotHeight});
  let content=`<title id="statistics-chart-title">${label}</title><desc id="statistics-chart-description">${description}</desc>`;
  for(const tick of ticks){const y=top+plotHeight-tick/ceiling*plotHeight;content+=`<path d="M${left} ${y}H${width-right}" class="chart-gridline"/><text x="${left-8}" y="${y+4}" text-anchor="end" class="chart-axis">${tick}</text>`;}
  if(type==="line") {
    let path="",connected=false;
    points.forEach((point,i)=>{if(!point.known){connected=false;return;}const {x,y}=position(point,i);path+=`${connected?"L":"M"}${x} ${y}`;connected=true;});
    content+=`<path d="${path}" fill="none" stroke="${color}" stroke-width="2.5" class="chart-line"/>`;
  }
  const interval=Math.max(1,Math.ceil(points.length/Math.max(2,Math.floor(plotWidth/60))));
  points.forEach((point,i)=>{
    const {x,y}=position(point,i),fill=!point.known?"#c7cebe":point.count?color:"#91a879";
    const title=`${point.label}：${point.known?`${point.count} 次`:"未纳入统计"}`;
    if(type==="line") {
      content+=`<circle cx="${x}" cy="${y}" r="${points.length>30?2.5:4}" fill="${point.known?fill:"white"}" stroke="${fill}" stroke-width="1.5" class="chart-point"><title>${title}</title></circle>`;
    } else {
      const barHeight=point.count/ceiling*plotHeight;
      content+=`<rect x="${x-barWidth/2}" y="${point.count?y:top+plotHeight-3}" width="${barWidth}" height="${point.count?barHeight:3}" rx="${Math.min(4,barWidth/2)}" fill="${fill}"><title>${title}</title></rect>`;
    }
    if(point.known&&points.length<=7)content+=`<text x="${x}" y="${y-10}" text-anchor="middle" class="chart-value">${point.count}</text>`;
    if((i%interval===0&&i<points.length-interval/2)||i===points.length-1)content+=`<text x="${x}" y="${height-12}" text-anchor="middle" class="chart-axis">${point.axis}</text>`;
    // 透明区域让密集数据点也能用鼠标或触屏选中。
    content+=`<rect x="${left+step*i}" y="${top}" width="${step}" height="${plotHeight}" fill="transparent" data-chart-index="${i}"><title>${title}</title></rect>`;
  });
  svg.setAttribute("viewBox",`0 0 ${width} ${height}`);svg.dataset.chartType=type;svg.innerHTML=content;
}

export function renderCharts(state,today,range=30,dimension="daily",type="line") {
  const stats=chartStatistics(state,today,range),monthly=dimension==="monthly";
  const weekdays=["周一","周二","周三","周四","周五","周六","周日"],periods=["00–06","06–12","12–18","18–24"];
  const views={
    daily:{title:"每日次数",column:"日期",color:"#b18a6b",points:stats.daily.map(d=>({label:d.date,axis:`${Number(d.date.slice(5,7))}/${Number(d.date.slice(-2))}`,count:d.count,known:d.tracked})),note:"首次记录之后，没有事件的日期按 0 次（没撸）统计；之前的日期留空。"},
    weekday:{title:"星期分布",column:"星期",color:"#91a879",points:stats.weekdays.map((count,i)=>({label:weekdays[i],axis:weekdays[i],count,known:true})),note:"把所选范围的次数按星期累计，看看更常出现在一周的哪一天。"},
    period:{title:"时段分布",column:"时段",color:"#aaa0bb",points:stats.periods.map((count,i)=>({label:`${periods[i]} 时`,axis:periods[i],count,known:true})),note:"把所选范围的次数按当前设备本地时间累计，每 6 小时一个时段。"},
    monthly:{title:"月度趋势",column:"月份",color:"#b18a6b",points:stats.months.map(m=>({label:m.month,axis:`${m.month.slice(2,4)}/${Number(m.month.slice(-2))}`,count:m.count,known:m.days>0})),note:"按月累计次数，展示最近 6 个月；统计从首次记录开始，本月统计至今天。"}
  };
  const view=views[dimension],total=monthly?stats.months.reduce((sum,m)=>sum+m.count,0):stats.total;
  const trackedDays=monthly?stats.months.reduce((sum,m)=>sum+m.days,0):stats.trackedDays;
  const period=monthly?"最近 6 个月":`近 ${range} 天`;
  document.querySelector("#chart-summary").textContent=`${period} · 撸了 ${total} 次 · 纳入统计 ${trackedDays} 天`;
  document.querySelector("#chart-range").hidden=monthly;
  document.querySelector("#chart-month-range").hidden=!monthly;
  document.querySelector("#chart-title").textContent=view.title;
  document.querySelector("#chart-unit").textContent=`${period} · 次`;
  document.querySelector("#chart-caption").textContent=trackedDays?view.note:"这个范围尚未开始统计，第一次记录之前的日期不计入。";
  document.querySelector("#chart-legend").hidden=dimension!=="daily"&&!monthly;
  document.querySelector("#chart-data-label").textContent=`查看${view.title}明细`;
  document.querySelector("#chart-data-dimension").textContent=view.column;
  document.querySelectorAll("#chart-dimension [data-dimension]").forEach(el=>el.setAttribute("aria-pressed",String(el.dataset.dimension===dimension)));
  document.querySelectorAll("#chart-type [data-chart-type]").forEach(el=>el.setAttribute("aria-pressed",String(el.dataset.chartType===type)));
  drawChart(view.points,{type,color:view.color,label:`${period}${view.title}，总计 ${total} 次`,description:view.note});
  const svg=document.querySelector("#statistics-chart");
  const showPoint=event=>{const target=event.target.closest("[data-chart-index]");if(!target)return;const point=view.points[Number(target.dataset.chartIndex)];document.querySelector("#chart-point-detail").textContent=`${point.label} · ${point.known?`${point.count} 次`:"未纳入统计"}`;};
  svg.onpointermove=showPoint;svg.onclick=showPoint;
  document.querySelector("#chart-point-detail").textContent="悬停或轻点图表，查看次数。";
  // 可展开的明细跟随维度切换，支持键盘和屏幕阅读器。
  const body=document.querySelector("#chart-data");body.replaceChildren();
  for(const point of view.points){const row=document.createElement("tr");for(const value of [point.label,point.known?`${point.count} 次`:"未纳入统计"]){const cell=document.createElement("td");cell.textContent=value;row.append(cell);}body.append(row);}
}
