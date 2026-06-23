/**
 * 案2 配賦エンジン（../allocation.js）の回帰テスト。
 * 実行: node scripts/test-allocation.mjs
 *
 * gas/DemoSeed.gs と同じロジックで合成データを生成し、配賦エンジンの不変条件と
 * 各ケース（全額フォールバック・Review枠フォールバック・諸費用・消費税）を検証する。
 * 将来 PHP 移植時の仕様照合にも使える。
 */
import { createRequire } from "module";
import { fileURLToPath } from "url";
import path from "path";
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const ENGINE = require(path.join(here, "..", "allocation.js"));

const TASK_CATALOG = [
  ["001","労務相談","service",100,0],["002","事務長代行","service",100,0],
  ["003","有給休暇管理","service",70,30],["026","給与計算","service",70,30],
  ["027","マイナンバー管理","excluded",0,0],["028","スポット手続","service",100,0],
  ["036","スポット手続","service",100,0],["037","スポット手続","service",70,30],
  ["046","就業規則","service",70,30],["056","賞与計算","service",70,30],
  ["060","諸費用","excluded",0,0],["061","給与支払報告書","service",70,30],
  ["062","算定基礎届","service",70,30],["063","労働保険年度更新","service",70,30],
  ["064","住民税変更","service",70,30],["065","年末調整","service",70,30],
  ["080","消費税","tax",0,0],["100","LAI","service",25,75]
];
const MONTHS = ["2026-03","2026-04","2026-05"];
const STAFF = [["S001","山田太郎"],["S002","佐藤花子"],["S003","鈴木一郎"],["S004","高橋美咲"],["S005","田中健太"],["S006","渡辺愛"]];
const CUSTOMERS = Array.from({length:12},(_,i)=>["C"+String(i+1).padStart(3,"0"),"顧客"+(i+1)]);
const TARGET = 160000;
const nameOf=(c)=>{const t=TASK_CATALOG.find(x=>x[0]===c);return t?t[1]:c;};
const ratioOf=(c,p)=>{const t=TASK_CATALOG.find(x=>x[0]===c);return t?(p==="PRE"?t[3]:t[4]):0;};
const preStaff=(i)=>STAFF[i%6][0], revStaff=(i)=>STAFF[(i+2)%6][0];
const staffName=(c)=>{const s=STAFF.find(x=>x[0]===c);return s?s[1]:c;};
function serviceItems(i,month){
  const base=20000+i*5000; const items=[["026",base]];
  if(i%3===1)items.push(["001",30000]); if(i%3===2)items.push(["037",45000]);
  if(i===0)items.push(["100",80000]);
  if((i===3||i===9)&&month==="2026-05")items.push(["056",60000]);
  return items;
}
const hasMisc=(i)=>i%2===0;
const transferOf=(m)=>{const y=+m.slice(0,4),mo=+m.slice(5,7);const ny=mo===12?y+1:y,nm=mo===12?1:mo+1;return ny+"-"+String(nm).padStart(2,"0")+"-22";};
function wl(date,sc,cc,cn,code,phase,h){return {id:"w_"+date+"_"+cc+"_"+code+"_"+phase,date,staffCode:sc,staff:staffName(sc),customerCode:cc,customer:cn,taskType:nameOf(code),taskCode:code,phaseCode:phase,hours:h};}

const tasks=TASK_CATALOG.map(t=>({code:t[0],name:t[1],allocationType:t[2]}));
const taskPhases=[]; TASK_CATALOG.forEach(t=>{if(t[2]==="service"){taskPhases.push({taskCode:t[0],phaseCode:"PRE",phaseName:"Prepare",ratio:t[3],sortOrder:1});taskPhases.push({taskCode:t[0],phaseCode:"REV",phaseName:"Review",ratio:t[4],sortOrder:2});}});
const customerStaff=[]; CUSTOMERS.forEach((c,i)=>{customerStaff.push({customerCode:c[0],staffCode:preStaff(i),role:"PRE",sortOrder:1});customerStaff.push({customerCode:c[0],staffCode:revStaff(i),role:"REV",sortOrder:2});});
const billing=[], entries=[], targets=[];
MONTHS.forEach(month=>{
  const date=month+"-15", transfer=transferOf(month);
  CUSTOMERS.forEach((c,ci)=>{
    const custCode=c[0], custName=c[1];
    const skipAll=(custCode==="C011"&&month==="2026-04");
    const skipRev=(custCode==="C012");
    let taxable=0;
    serviceItems(ci,month).forEach(it=>{
      const [code,net]=it; taxable+=net;
      billing.push({invoiceId:"b_"+month+"_"+custCode+"_"+code,billingMonth:month,customerCode:custCode,customer:custName,invoiceItem:nameOf(code),invoiceItemCode:code,netAmount:net,transferDate:transfer});
      if(skipAll)return;
      if(ratioOf(code,"PRE")>0){entries.push(wl(date,preStaff(ci),custCode,custName,code,"PRE",Math.max(1,Math.round(net/15000))));}
      if(ratioOf(code,"REV")>0&&!skipRev){entries.push(wl(date,revStaff(ci),custCode,custName,code,"REV",Math.max(1,Math.round(net/40000))));}
    });
    if(hasMisc(ci)){const misc=1500;taxable+=misc;billing.push({invoiceId:"b_"+month+"_"+custCode+"_060",billingMonth:month,customerCode:custCode,customer:custName,invoiceItem:"諸費用",invoiceItemCode:"060",netAmount:misc,transferDate:transfer});}
    const tax=Math.round(taxable*0.10);
    if(tax>0)billing.push({invoiceId:"b_"+month+"_"+custCode+"_080",billingMonth:month,customerCode:custCode,customer:custName,invoiceItem:"消費税",invoiceItemCode:"080",netAmount:tax,transferDate:transfer});
  });
  STAFF.forEach(s=>entries.push({id:"w_"+date+"_INT_"+s[0],date,staffCode:s[0],staff:s[1],customerCode:"",customer:"",taskType:"社内/その他",taskCode:"",phaseCode:"",hours:5}));
  STAFF.forEach(s=>targets.push({targetMonth:month,staffCode:s[0],staff:s[1],targetAmount:TARGET}));
});
const data={staff:STAFF.map(s=>({code:s[0],name:s[1]})),customers:CUSTOMERS.map(c=>({code:c[0],name:c[1]})),tasks,taskPhases,customerStaff,settings:{billingOffset:"0"},entries,billing,targets};

const EPS=0.5; let pass=0, fail=0;
const check=(name,cond,extra="")=>{cond?pass++:fail++;console.log((cond?"  OK ":"FAIL ")+name+(extra?"  "+extra:""));};
MONTHS.forEach(month=>{
  const m=ENGINE.buildMonthModel(data,month);
  const sumAttr=m.staff.reduce((a,s)=>a+s.attributedRevenue,0);
  const sumBacked=m.staff.reduce((a,s)=>a+s.backedRevenue,0);
  check(`[${month}] Σ帰属売上 = 役務売上`, Math.abs(sumAttr-m.firm.serviceRevenue)<EPS);
  check(`[${month}] 税抜 = 役務+対象外`, Math.abs(m.firm.grossRevenue-(m.firm.serviceRevenue+m.firm.excludedRevenue))<EPS);
  check(`[${month}] 未配賦=0`, m.firm.unallocated===0);
  check(`[${month}] 工数対応 ≤ 役務`, sumBacked<=m.firm.serviceRevenue+EPS);
  check(`[${month}] 消費税>0 かつ 税抜に非含`, m.firm.tax>0 && Math.abs(m.firm.tax/m.firm.grossRevenue-0.10)<0.01);
});
const apr=ENGINE.buildMonthModel(data,"2026-04");
const c11=apr.customers.find(c=>c.code==="C011");
check("C011(2026-04) 全額フォールバック backed=0", c11 && Math.abs(c11.backedRevenue)<EPS);
check("C011(2026-04) hours=0 → rate=null", c11 && c11.rate===null);
const may=ENGINE.buildMonthModel(data,"2026-05");
const c12=may.customers.find(c=>c.code==="C012");
check("C012 Review枠フォールバック 0<backed<service", c12 && c12.backedRevenue>0 && c12.backedRevenue<c12.serviceRevenue);
const c1=may.customers.find(c=>c.code==="C001");
check("C001 諸費用=対象外・役務に非混入", c1 && c1.excludedRevenue>0 && c1.grossRevenue===c1.serviceRevenue+c1.excludedRevenue);

console.log(`\nRESULT: ${pass} passed / ${fail} failed`);
process.exit(fail ? 1 : 0);
