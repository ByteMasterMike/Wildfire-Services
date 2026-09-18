import { useEffect, useRef, useState } from 'react';

export interface ReferenceLine { label: string; color: string; values: (number | null)[] }
export function TemporalPlot({ values, labels, ceiling, compact = false, unit, onInspect, referenceLines = [] }: {
  values: (number | null)[]; labels: string[]; ceiling: number; compact?: boolean;
  unit: string; onInspect: (index: number | null) => void;
  referenceLines?: ReferenceLine[];
}) {
  const host = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({width:300,height:compact?96:250});
  const [active, setActive] = useState<number | null>(null);
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => setSize({width:Math.max(120,entry.contentRect.width),height:Math.max(80,entry.contentRect.height)}));
    observer.observe(host.current!); return () => observer.disconnect();
  }, []);
  const periodKey = labels.join('|');
  useEffect(()=>setActive(null),[periodKey]);
  const left=36, right=size.width-14, top=22, bottom=size.height-26;
  const x=(index:number)=>values.length<2?(left+right)/2:left+index/(values.length-1)*(right-left);
  const y=(value:number)=>bottom-value/ceiling*(bottom-top);
  const pathFor=(points:(number|null)[])=>points.map((value,index)=>value===null?'':`${index===0||points[index-1]===null?'M':'L'}${x(index)} ${y(value)}`).join(' ');
  const ticks=[...new Set([0,Math.floor((values.length-1)/2),values.length-1])].filter(index=>index>=0);
  const inspect=(index:number|null)=>{setActive(index);onInspect(index);};
  return <div ref={host} className={`temporal-plot ${compact?'is-mini':''}`}>
    <svg viewBox={`0 0 ${size.width} ${size.height}`} role="img" tabIndex={0} aria-label={`${unit}: ${labels[0]??''} to ${labels.at(-1)??''}. Arrow keys inspect periods.`}
      onMouseMove={event=>{const rect=event.currentTarget.getBoundingClientRect();inspect(Math.max(0,Math.min(values.length-1,Math.round(((event.clientX-rect.left)/rect.width*size.width-left)/(right-left)*Math.max(0,values.length-1)))));}}
      onMouseLeave={()=>inspect(null)} onBlur={()=>inspect(null)}
      onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();inspect(Math.max(0,Math.min(values.length-1,(active??0)+(event.key==='ArrowRight'?1:-1))));}}}>
      <text x={left} y={12}>{unit}</text>
      {[0,ceiling/2,ceiling].map(value=><g key={value}><path d={`M${left} ${y(value)}H${right}`} stroke="var(--chart-grid)"/><text x={left-7} y={y(value)+4} textAnchor="end">{value.toLocaleString(undefined,{maximumFractionDigits:1})}</text></g>)}
      {ticks.map(index=><text key={index} x={x(index)} y={size.height-7} textAnchor={index===0?'start':index===values.length-1?'end':'middle'}>{labels[index]}</text>)}
      {referenceLines.map(line=><g key={line.label} aria-label={line.label}><path d={pathFor(line.values)} stroke={line.color} strokeWidth="1.4" strokeDasharray="5 4" opacity="0.65" fill="none" strokeLinejoin="round"/>
        {line.values.map((value,index)=>value!==null&&(index===0||line.values[index-1]===null)&&(index===line.values.length-1||line.values[index+1]===null)&&<circle key={index} cx={x(index)} cy={y(value)} r="2.5" fill={line.color}/>)}</g>)}
      <path d={pathFor(values)} stroke="#b7a0f0" strokeWidth={compact?1.8:referenceLines.length?2.8:2} fill="none" strokeLinejoin="round"/>
      {values.map((value,index)=>value!==null&&(values.length<25||(index===0||values[index-1]===null)&&(index===values.length-1||values[index+1]===null))&&<circle key={index} cx={x(index)} cy={y(value)} r={compact?2:3} fill="#b7a0f0"/>)}
      {active!==null&&active<values.length&&<g><path d={`M${x(active)} ${top}V${bottom}`} stroke="var(--chart-cursor)" strokeDasharray="3 3"/>{referenceLines.map(line=>line.values[active]!=null&&<circle key={line.label} cx={x(active)} cy={y(line.values[active]!)} r="3" fill={line.color}/>)}{values[active]!==null&&<circle cx={x(active)} cy={y(values[active]!)} r="4" fill="#b7a0f0"/>}</g>}
    </svg>
  </div>;
}
