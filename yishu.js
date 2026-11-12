/* ============================================================================
 * yishu.js  —  万机决策分析系统 · 术数引擎
 * ----------------------------------------------------------------------------
 * 汇总奇门遁甲 / 四柱八字 / 梅花易数 三套纯计算引擎，
 * 以及必要的数据字典。所有函数和常量挂在 window 上，
 * xiaoxuan.html 与 analysis.html 共同引用，analysis.html 无需改动。
 *
 * 来源：analysis.html 中原生引擎代码 + xiaoxuan.html 移植的奇门版本
 * 命名：统一使用原始名字（GAN / ZHI / JQ / qimenPaiPan / getBazi ...），
 *       与 analysis.html 完全一致，无 XQ_ 前缀。
 * ==========================================================================*/

/* ============ 公共常量（干支/节气/五行） ============ */
const YANGS=['冬至','小寒','大寒','立春','雨水','惊蛰','春分','清明','谷雨','立夏','小满','芒种'];
const SHANG="子午卯酉";
const ZHONG="寅申巳亥";
const JU={
  阳遁:{
    冬至:[1,7,4],小寒:[2,8,5],大寒:[3,9,6],立春:[8,5,2],雨水:[9,6,3],
    惊蛰:[1,7,4],春分:[3,9,6],清明:[4,1,7],谷雨:[5,2,8],立夏:[4,1,7],
    小满:[5,2,8],芒种:[6,3,9]
  },
  阴遁:{
    夏至:[9,3,6],小暑:[8,2,5],大暑:[7,1,4],立秋:[2,5,8],处暑:[1,4,7],
    白露:[9,3,6],秋分:[7,1,4],寒露:[6,9,3],霜降:[5,8,2],立冬:[6,9,3],
    小雪:[5,8,2],大雪:[4,7,1]
  }
};
const MA={'申':'寅','子':'寅','辰':'寅','寅':'申','午':'申','戌':'申','巳':'亥','酉':'亥','丑':'亥','亥':'巳','卯':'巳','未':'巳'};

const GAN="甲乙丙丁戊己庚辛壬癸";
const ZHI="子丑寅卯辰巳午未申酉戌亥";
const JQ=['冬至','小寒','大寒','立春','雨水','惊蛰','春分','清明','谷雨','立夏','小满','芒种',
          '夏至','小暑','大暑','立秋','处暑','白露','秋分','寒露','霜降','立冬','小雪','大雪'];

/* ============ 奇门专有常量 ============ */
const YANG=[8,3,4,9,2,7,6,1];                  // 阳遁排布用宫序（不含中5）
const SANQI="戊己庚辛壬癸丁丙乙";
const XING=['蓬','任','冲','辅','英','芮禽','柱','心'];
const XINGB=['蓬','芮','冲','辅','禽','心','柱','任','英'];
const MEN=['休','生','伤','杜','景','死','惊','开'];
const MENB=['休','死','伤','杜','死','开','惊','生','景'];
const SHEN_Y=['值符','腾蛇','太阴','六合','白虎','玄武','九地','九天'];
const SHEN_N=['值符','九天','九地','玄武','白虎','六合','太阴','腾蛇'];
const LS_S=[1,2,3,4,5,6,7,8,9];
const LS_N=[1,9,8,7,6,5,4,3,2];
const GONGNAME={1:'坎',8:'艮',3:'震',4:'巽',9:'离',2:'坤',7:'兑',6:'乾',5:'中'};
const Z2G={'子':1,'丑':8,'寅':8,'卯':3,'辰':4,'巳':4,'午':9,'未':2,'申':2,'酉':7,'戌':6,'亥':6};
const XUN={
  "甲子":["甲子","戊",["戌","亥"],"甲子"],"乙丑":["甲子","戊",["戌","亥"],"甲子"],"丙寅":["甲子","戊",["戌","亥"],"甲子"],
  "丁卯":["甲子","戊",["戌","亥"],"甲子"],"戊辰":["甲子","戊",["戌","亥"],"甲子"],"己巳":["甲子","戊",["戌","亥"],"己巳"],
  "庚午":["甲子","戊",["戌","亥"],"己巳"],"辛未":["甲子","戊",["戌","亥"],"己巳"],"壬申":["甲子","戊",["戌","亥"],"己巳"],
  "癸酉":["甲子","戊",["戌","亥"],"己巳"],"甲戌":["甲戌","己",["申","酉"],"甲戌"],"乙亥":["甲戌","己",["申","酉"],"甲戌"],
  "丙子":["甲戌","己",["申","酉"],"甲戌"],"丁丑":["甲戌","己",["申","酉"],"甲戌"],"戊寅":["甲戌","己",["申","酉"],"甲戌"],
  "己卯":["甲戌","己",["申","酉"],"己卯"],"庚辰":["甲戌","己",["申","酉"],"己卯"],"辛巳":["甲戌","己",["申","酉"],"己卯"],
  "壬午":["甲戌","己",["申","酉"],"己卯"],"癸未":["甲戌","己",["申","酉"],"己卯"],"甲申":["甲申","庚",["午","未"],"甲申"],
  "乙酉":["甲申","庚",["午","未"],"甲申"],"丙戌":["甲申","庚",["午","未"],"甲申"],"丁亥":["甲申","庚",["午","未"],"甲申"],
  "戊子":["甲申","庚",["午","未"],"甲申"],"己丑":["甲申","庚",["午","未"],"己丑"],"庚寅":["甲申","庚",["午","未"],"己丑"],
  "辛卯":["甲申","庚",["午","未"],"己丑"],"壬辰":["甲申","庚",["午","未"],"己丑"],"癸巳":["甲申","庚",["午","未"],"己丑"],
  "甲午":["甲午","辛",["辰","巳"],"甲午"],"乙未":["甲午","辛",["辰","巳"],"甲午"],"丙申":["甲午","辛",["辰","巳"],"甲午"],
  "丁酉":["甲午","辛",["辰","巳"],"甲午"],"戊戌":["甲午","辛",["辰","巳"],"甲午"],"己亥":["甲午","辛",["辰","巳"],"己亥"],
  "庚子":["甲午","辛",["辰","巳"],"己亥"],"辛丑":["甲午","辛",["辰","巳"],"己亥"],"壬寅":["甲午","辛",["辰","巳"],"己亥"],
  "癸卯":["甲午","辛",["辰","巳"],"己亥"],"甲辰":["甲辰","壬",["寅","卯"],"甲辰"],"乙巳":["甲辰","壬",["寅","卯"],"甲辰"],
  "丙午":["甲辰","壬",["寅","卯"],"甲辰"],"丁未":["甲辰","壬",["寅","卯"],"甲辰"],"戊申":["甲辰","壬",["寅","卯"],"甲辰"],
  "己酉":["甲辰","壬",["寅","卯"],"己酉"],"庚戌":["甲辰","壬",["寅","卯"],"己酉"],"辛亥":["甲辰","壬",["寅","卯"],"己酉"],
  "壬子":["甲辰","壬",["寅","卯"],"己酉"],"癸丑":["甲辰","壬",["寅","卯"],"己酉"],"甲寅":["甲寅","癸",["子","丑"],"甲寅"],
  "乙卯":["甲寅","癸",["子","丑"],"甲寅"],"丙辰":["甲寅","癸",["子","丑"],"甲寅"],"丁巳":["甲寅","癸",["子","丑"],"甲寅"],
  "戊午":["甲寅","癸",["子","丑"],"甲寅"],"己未":["甲寅","癸",["子","丑"],"己未"],"庚申":["甲寅","癸",["子","丑"],"己未"],
  "辛酉":["甲寅","癸",["子","丑"],"己未"],"壬戌":["甲寅","癸",["子","丑"],"己未"],"癸亥":["甲寅","癸",["子","丑"],"己未"]
};
const KXWX={"金":"木","木":"土","土":"水","水":"火","火":"金"};
const SXWX={"金":"水","木":"火","土":"金","水":"木","火":"土"};
const MENWX={休:"水",生:"土",伤:"木",杜:"木",景:"火",死:"土",惊:"金",开:"金"};
const GONGWX={1:"水",2:"土",3:"木",4:"木",5:"土",6:"金",7:"金",8:"土",9:"火"};
const GANWX={甲:"木",乙:"木",丙:"火",丁:"火",戊:"土",己:"土",庚:"金",辛:"金",壬:"水",癸:"水"};
const ZHIWX={子:"水",丑:"土",寅:"木",卯:"木",辰:"土",巳:"火",午:"火",未:"土",申:"金",酉:"金",戌:"土",亥:"水"};
const JIXING={戊:[3,"震","卯","无礼"],己:[2,"坤","未","持势"],庚:[8,"艮","寅","无恩"],辛:[9,"离","午","自刑"],壬:[4,"巽","辰","自刑"],癸:[4,"巽","巳","无恩"]};
const RUMU={甲:"未",乙:"戌",丙:"戌",丁:"丑",戊:"戌",己:"丑",庚:"丑",辛:"辰",壬:"辰",癸:"未"};
const XBEN={蓬:1,任:8,冲:3,辅:4,英:9,芮:2,柱:7,心:6,禽:5};

/* ============ 梅花易数常量 ============ */
const MH_GUA=[
  {n:1,name:"乾",wx:"金",sym:"☰",yao:[1,1,1],houTian:"西北"},
  {n:2,name:"兑",wx:"金",sym:"☱",yao:[1,1,0],houTian:"西"},
  {n:3,name:"离",wx:"火",sym:"☲",yao:[1,0,1],houTian:"南"},
  {n:4,name:"震",wx:"木",sym:"☳",yao:[1,0,0],houTian:"东"},
  {n:5,name:"巽",wx:"木",sym:"☴",yao:[0,1,1],houTian:"东南"},
  {n:6,name:"坎",wx:"水",sym:"☵",yao:[0,1,0],houTian:"北"},
  {n:7,name:"艮",wx:"土",sym:"☶",yao:[0,0,1],houTian:"东北"},
  {n:8,name:"坤",wx:"土",sym:"☷",yao:[0,0,0],houTian:"西南"}
];
const MH_64={
  11:{num:1,short:"乾",full:"乾为天"},88:{num:2,short:"坤",full:"坤为地"},
  64:{num:3,short:"屯",full:"水雷屯"},76:{num:4,short:"蒙",full:"山水蒙"},
  61:{num:5,short:"需",full:"水天需"},16:{num:6,short:"讼",full:"天水讼"},
  86:{num:7,short:"师",full:"地水师"},68:{num:8,short:"比",full:"水地比"},
  51:{num:9,short:"小畜",full:"风天小畜"},12:{num:10,short:"履",full:"天泽履"},
  81:{num:11,short:"泰",full:"地天泰"},18:{num:12,short:"否",full:"天地否"},
  13:{num:13,short:"同人",full:"天火同人"},31:{num:14,short:"大有",full:"火天大有"},
  87:{num:15,short:"谦",full:"地山谦"},48:{num:16,short:"豫",full:"雷地豫"},
  24:{num:17,short:"随",full:"泽雷随"},75:{num:18,short:"蛊",full:"山风蛊"},
  82:{num:19,short:"临",full:"地泽临"},58:{num:20,short:"观",full:"风地观"},
  34:{num:21,short:"噬嗑",full:"火雷噬嗑"},73:{num:22,short:"贲",full:"山火贲"},
  78:{num:23,short:"剥",full:"山地剥"},84:{num:24,short:"复",full:"地雷复"},
  14:{num:25,short:"无妄",full:"天雷无妄"},71:{num:26,short:"大畜",full:"山天大畜"},
  74:{num:27,short:"颐",full:"山雷颐"},25:{num:28,short:"大过",full:"泽风大过"},
  66:{num:29,short:"坎",full:"坎为水"},33:{num:30,short:"离",full:"离为火"},
  27:{num:31,short:"咸",full:"泽山咸"},45:{num:32,short:"恒",full:"雷风恒"},
  17:{num:33,short:"遁",full:"天山遁"},41:{num:34,short:"大壮",full:"雷天大壮"},
  38:{num:35,short:"晋",full:"火地晋"},83:{num:36,short:"明夷",full:"地火明夷"},
  53:{num:37,short:"家人",full:"风火家人"},32:{num:38,short:"睽",full:"火泽睽"},
  67:{num:39,short:"蹇",full:"水山蹇"},46:{num:40,short:"解",full:"雷水解"},
  72:{num:41,short:"损",full:"山泽损"},54:{num:42,short:"益",full:"风雷益"},
  21:{num:43,short:"夬",full:"泽天夬"},15:{num:44,short:"姤",full:"天风姤"},
  28:{num:45,short:"萃",full:"泽地萃"},85:{num:46,short:"升",full:"地风升"},
  26:{num:47,short:"困",full:"泽水困"},65:{num:48,short:"井",full:"水风井"},
  23:{num:49,short:"革",full:"泽火革"},35:{num:50,short:"鼎",full:"火风鼎"},
  44:{num:51,short:"震",full:"震为雷"},77:{num:52,short:"艮",full:"艮为山"},
  57:{num:53,short:"渐",full:"风山渐"},42:{num:54,short:"归妹",full:"雷泽归妹"},
  43:{num:55,short:"丰",full:"雷火丰"},37:{num:56,short:"旅",full:"火山旅"},
  55:{num:57,short:"巽",full:"巽为风"},22:{num:58,short:"兑",full:"兑为泽"},
  56:{num:59,short:"涣",full:"风水涣"},62:{num:60,short:"节",full:"水泽节"},
  52:{num:61,short:"中孚",full:"风泽中孚"},47:{num:62,short:"小过",full:"雷山小过"},
  63:{num:63,short:"既济",full:"水火既济"},36:{num:64,short:"未济",full:"火水未济"}
};
const MH_ZHI_NUM={子:1,丑:2,寅:3,卯:4,辰:5,巳:6,午:7,未:8,申:9,酉:10,戌:11,亥:12};


/* ============================================================================
 * 天文历法（儒略日 / 太阳黄经 / 节气）
 * ==========================================================================*/
function jdFromDate(y,m,d,h){
  const ms=Date.UTC(y,m-1,d,h,0,0);
  return ms/86400000+2440587.5;
}
function julianToGregorian(y,m,d){ // 儒略历 → 格里历
  const a=Math.floor((14-m)/12),yy=y+4800-a,mm=m+12*a-3;
  const jdn=d+Math.floor((153*mm+2)/5)+365*yy+Math.floor(yy/4)-32083;
  const g=jdn+1401+Math.floor((Math.floor((4*jdn+274277)/146097)*3)/4)-38;
  const e=4*g+3,hh=Math.floor((e%1461)/4),ii=5*hh+2;
  const dd=Math.floor((ii%153)/5)+1;
  const mm2=(Math.floor(ii/153)+2)%12+1;
  const yy2=Math.floor(e/1461)-4716+Math.floor((12+2-mm2)/12);
  return {y:yy2,m:mm2,d:dd};
}
function dayGZ(y,m,d){
  return (Math.floor(jdFromDate(y,m,d,12))+49)%60;
}
function gzAt(i){
  return GAN[i%10]+ZHI[i%12];
}
/* 太阳视黄经（Meeus 连续）*/
function sunLongitude(jd){
  const T=(jd-2451545.0)/36525;
  const L0=280.46646+T*(36000.76983+T*0.0003032);
  const M=357.52911+T*(35999.05029-0.0001537*T);
  const Mr=M*Math.PI/180;
  const C=Math.sin(Mr)*(1.914602-T*(0.004817+0.000014*T))
       +Math.sin(2*Mr)*(0.019993-0.000101*T)
       +Math.sin(3*Mr)*0.000289;
  const trueL=L0+C;
  const Omega=125.04-1934.136*T;
  const dL=-0.00569-0.00478*Math.sin(Omega*Math.PI/180);
  return trueL+dL;
}
function termLong(idx){ return (idx*15+270)%360; }
function findTermTime(year,idx){
  const target=termLong(idx);
  const start=jdFromDate(year,1,1,0);
  const L0=sunLongitude(start);
  const L0m=((L0%360)+360)%360;
  const diff=((target-L0m)%360+360)%360;
  const absT=L0+diff;
  let lo=start,hi=start+366;
  for(let i=0;i<90;i++){
    const mid=(lo+hi)/2;
    if(sunLongitude(mid)<absT) lo=mid; else hi=mid;
  }
  return (lo+hi)/2;
}
function jdToDate(jd){
  const d=new Date((jd-2440587.5)*86400000+8*3600000);
  return {y:d.getUTCFullYear(),m:d.getUTCMonth()+1,dd:d.getUTCDate(),h:d.getUTCHours(),mi:d.getUTCMinutes()};
}
function getSolarTerm(y,m,d,h,mi){
  const jd=jdFromDate(y,m,d,h,mi/60);
  let best=null;
  for(let yy=y-1;yy<=y+1;yy++){
    for(let i=0;i<24;i++){
      const t=findTermTime(yy,i);
      if(t<=jd&&(!best||t>best.t)) best={t,i};
    }
  }
  return JQ[best.i];
}


/* ============================================================================
 * 四柱八字引擎
 * ==========================================================================*/
function getBazi(y,m,d,h,mi){
  const jdNow=jdFromDate(y,m,d,h,mi/60);
  const lichun=findTermTime(y,3);
  const gzYear=jdNow>=lichun?y:y-1;
  const yearGz=gzAt(((gzYear-4)%60+60)%60);
  const jieMZ=[[1,1],[3,2],[5,3],[7,4],[9,5],[11,6],[13,7],[15,8],[17,9],[19,10],[21,11],[23,0]];
  let monthZhi=-1;
  for(const [ji,mz] of jieMZ){
    if(jdNow>=findTermTime(y,ji)) monthZhi=mz;
    else break;
  }
  if(monthZhi<0){
    if(jdNow>=findTermTime(y-1,23)) monthZhi=0;
    else if(jdNow>=findTermTime(y-1,21)) monthZhi=11;
    else monthZhi=10;
  }
  const yg=GAN.indexOf(yearGz[0]);
  const firstGan=(yg%5*2+2)%10;
  const offZhi=(monthZhi-2+12)%12;
  const monthGz=GAN[(firstGan+offZhi)%10]+ZHI[monthZhi];
  const dayGz=gzAt(dayGZ(y,m,d));
  const dg=GAN.indexOf(dayGz[0]);
  const ziGan=(dg%5*2)%10;
  const sz=Math.floor((h+1)/2)%12;
  const hourGz=GAN[(ziGan+sz)%10]+ZHI[sz];
  const jieqi=getSolarTerm(y,m,d,h,mi);
  const bazi={year:yearGz,month:monthGz,day:dayGz,hour:hourGz};
  return {
    solar_date:y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0')+' '+String(h).padStart(2,'0')+':'+String(mi).padStart(2,'0')+':00',
    bazi,bazi_str:yearGz+' '+monthGz+' '+dayGz+' '+hourGz,
    jie_qi:jieqi,
    year:yearGz,month:monthGz,day:dayGz,hour:hourGz,jieqi,
    y,m,d,h,mi,monthZhi
  };
}

/* --- 大运 --- */
function gzToIdx(gz){
  const g=GAN.indexOf(gz[0]),z=ZHI.indexOf(gz[1]);
  for(let i=0;i<60;i++){ if(i%10===g&&i%12===z) return i; }
  return -1;
}
function calcDayun(bazi,gender){
  const yg=bazi.year[0]; const ygIdx=GAN.indexOf(yg); const yangNian=ygIdx%2===0;
  const shun=(yangNian&&gender==="男")||(!yangNian&&gender==="女");
  const JIE_NAME={1:"小寒",3:"立春",5:"惊蛰",7:"清明",9:"立夏",11:"芒种",13:"小暑",15:"立秋",17:"白露",19:"寒露",21:"立冬",23:"大雪"};
  const jieIdx=[1,3,5,7,9,11,13,15,17,19,21,23];
  const jdNow=jdFromDate(bazi.y,bazi.m,bazi.d,bazi.h,bazi.mi/60);
  let refJie=null,refName="";
  for(let yy=bazi.y-1;yy<=bazi.y+1;yy++){
    for(const ji of jieIdx){
      const t=findTermTime(yy,ji);
      if(shun&&t>jdNow&&(!refJie||t<refJie)){ refJie=t; refName=JIE_NAME[ji]; }
      if(!shun&&t<jdNow&&(!refJie||t>refJie)){ refJie=t; refName=JIE_NAME[ji]; }
    }
  }
  const daysTo=Math.abs(refJie-jdNow);
  const years=daysTo/3;
  const ageStart=Math.floor(years*10)/10;
  const startYear=bazi.y+Math.floor(ageStart);
  const mi=gzToIdx(bazi.month);
  const step=shun?1:-1;
  const yun=[];
  for(let k=1;k<=10;k++){
    const idx=(((mi+step*k)%60)+60)%60;
    const from=startYear+(k-1)*10;
    yun.push({gz:gzAt(idx),from,to:from+10,ageStart:Math.floor(ageStart)+(k-1)*10});
  }
  return {shun,ageStart,startYear,refName,yun};
}

/* --- 五行关系 --- */
function wxRel(g1,g2){
  if(g1===g2) return "比和";
  if(SXWX[g1]===g2) return "生("+g1+"生"+g2+")";
  if(KXWX[g1]===g2) return "克("+g1+"克"+g2+")";
  if(SXWX[g2]===g1) return "泄("+g2+"生"+g1+")";
  return "克("+g2+"克"+g1+")";
}


/* ============================================================================
 * 四柱八字分析引擎（地支藏干、十神、旺衰、大运评分、命运曲线）
 * 来源：analysis.html 中原生分析代码，抽至 yishu.js 供 xiaoxuan.html 复用
 * ==========================================================================*/

/* --- 地支藏干常量 --- */
// 地支本气藏干（论十神用）
const ZHI_BENQI={子:"癸",丑:"己",寅:"甲",卯:"乙",辰:"戊",巳:"丙",午:"丁",未:"己",申:"庚",酉:"辛",戌:"戊",亥:"壬"};
// 地支藏干完整表（本气/中气/余气，论旺衰通根用）
const ZHI_CANGGAN={子:["癸"],丑:["己","癸","辛"],寅:["甲","丙","戊"],卯:["乙"],辰:["戊","乙","癸"],巳:["丙","戊","庚"],午:["丁","己"],未:["己","丁","乙"],申:["庚","壬","戊"],酉:["辛"],戌:["戊","辛","丁"],亥:["壬","甲"]};

/* --- 十神关系（纯计算） --- */
function ganRel(dayGan,targetGan){ // 日主 vs 某干 → 十神 + 生帮克泄耗
  const same=(GAN.indexOf(dayGan)%2)===(GAN.indexOf(targetGan)%2);
  const d=GANWX[dayGan],t=GANWX[targetGan];
  let type,god;
  if(d===t){type="帮";god=same?"比肩":"劫财";}
  else if(SXWX[d]===t){type="泄";god=same?"食神":"伤官";}   // 我生 → 泄
  else if(SXWX[t]===d){type="生";god=same?"偏印":"正印";}   // 生我 → 生
  else if(KXWX[d]===t){type="耗";god=same?"偏财":"正财";}   // 我克 → 耗
  else{type="克";god=same?"七杀":"正官";}                   // 克我 → 克
  return {type,god};
}
function zhiRel(dayGan,zhi){return ganRel(dayGan,ZHI_BENQI[zhi]);} // 支以本气藏干论

/* --- 大运评分辅助（纯计算） --- */
function yunScoreParts(dg,gz){ // 拆分天干/地支对日主的帮扶分：天干±1；地支按藏干本气±1、中气±0.5、余气±0.25
  let gan=0,zhi=0;
  const g=gz[0],w=GANWX[g];
  gan=(w===GANWX[dg]||SXWX[w]===GANWX[dg])?1:-1;
  const z=gz[1],cs=ZHI_CANGGAN[z]||[ZHI_BENQI[z]];
  for(let i=0;i<cs.length;i++){
    const cw=GANWX[cs[i]];
    zhi+=(i===0?1:(i===1?0.5:0.25))*(cw===GANWX[dg]||SXWX[cw]===GANWX[dg]?1:-1);
  }
  return {gan,zhi};
}
function yunScore(dg,gz){const p=yunScoreParts(dg,gz);return p.gan+p.zhi;}
function gzGood(dg,weak,part){ // 该字对日主旺衰的作用方向：弱身需帮(part>0)趋平和为吉；旺身需抑(part<0)趋平和为吉
  return weak?(part>0):(part<0);
}
function dayunScore(prof,yunGz){ // 大运分值：干支皆吉+20 / 干吉支凶+10 / 干凶支吉+5 / 干支皆凶-20（吉=使日主旺衰趋平和；干凶支吉以地支吉为主导，天干凶仅拉低）
  const p=yunScoreParts(prof.dg,yunGz);
  const gG=gzGood(prof.dg,prof.weak,p.gan);
  const zG=gzGood(prof.dg,prof.weak,p.zhi);
  if(gG&&zG)return 20;
  if(gG)return 10;
  if(zG)return 5;
  return -20;
}
function liunianScore(prof,gz){ // 流年分值：干支皆吉+3 / 干吉支凶+2 / 干凶支吉+1 / 干支皆凶-2（吉=使日主旺衰趋平和；干凶支吉以地支吉为主导）
  const p=yunScoreParts(prof.dg,gz);
  const gG=gzGood(prof.dg,prof.weak,p.gan);
  const zG=gzGood(prof.dg,prof.weak,p.zhi);
  if(gG&&zG)return 3;
  if(gG)return 2;
  if(zG)return 1;
  return -2;
}
function dayunTendency(prof,yunGz){ // 大运扶抑 → 上坡/下坡（按干支二字对日主旺衰的趋平/偏离判定：弱身帮扶、旺身克泄皆趋平和为吉）
  const weak=prof.level.indexOf("弱")>=0;
  const ds=dayunScore(prof,yunGz);
  const p=yunScoreParts(prof.dg,yunGz);
  const gTxt=gzGood(prof.dg,weak,p.gan)?"吉":"凶",zTxt=gzGood(prof.dg,weak,p.zhi)?"吉":"凶";
  const both=gTxt===zTxt?("皆"+gTxt):"干"+gTxt+"支"+zTxt;
  let tendency,reason;
  if(ds>0){
    tendency="上坡路";
    reason=weak?"日主本弱，大运"+yunGz+"（"+both+"）生扶趋平和（扶抑得当），弱身得助，整体趋势向上，宜借势进取":"日主本强，大运"+yunGz+"（"+both+"）克泄抑强趋平和（抑强使衡），身强可担财官，整体趋势向上";
  }else if(ds<0){
    tendency="下坡路";
    reason=weak?"日主本弱，大运"+yunGz+"（"+both+"）克泄耗偏离平和（雪上加霜），身弱难担，宜守不宜攻":"日主本强，大运"+yunGz+"（"+both+"）再添生扶偏离平和（过旺无制），趋势受阻，易见阻滞反复";
  }else{tendency="平运";reason="大运"+yunGz+"帮扶平平，趋势平稳，宜稳扎稳打";}
  return {tendency,reason,score:ds,gan:p.gan,zhi:p.zhi};
}
function yearVerdict(prof,yunGz,gz){ // 流年定应期：2×2 吉凶矩阵（上坡顺势大吉/上坡逆势小凶/下坡顺势大凶/下坡逆势小吉）；流年分=干支二字分值（皆吉+3/干吉支凶+2/干凶支吉+1/皆凶-2）
  const dy=dayunTendency(prof,yunGz);
  const ds=dayunScore(prof,yunGz);
  const ls=liunianScore(prof,gz);
  const dyUp=ds>0,liuUp=ls>0;
  let grade,tip,score=ls;
  if(dyUp){
    if(liuUp){grade="大吉";tip="上坡路中流年顺势（"+gz+"趋平和帮身），事半功倍，为应期之吉，宜积极把握";}
    else{grade="小凶";tip="上坡路中流年逆势（"+gz+"耗克偏离平和），上行途中略有回撤，属正常颠簸，稳住节奏、不逆势硬冲即可";}
  }else if(ds<0){
    if(liuUp){grade="小吉";tip="下坡路中流年逆势生扶（"+gz+"），可借喘息之机蓄力调整，但大势未转，不宜冒进";}
    else{grade="大凶";tip="下坡路中流年顺势再受克泄耗（"+gz+"），雪上加霜，为应期之凶，宜守不宜攻，谨防破耗与是非";}
  }else{ // 平运（罕见）：流年自身方向定吉凶
    if(liuUp){grade="吉";tip="平运中流年趋平和帮身（"+gz+"），稳中有进，可小幅进取";}
    else{grade="凶";tip="平运中流年略有耗克（"+gz+"），宜收敛保守，避免无谓消耗";}
  }
  return {grade,tip,score,dy,ds,ls};
}

/* --- 命运曲线（纯计算） --- */
function fmtScore(v){return (v>0?"+":"")+v;}
function calcFateSeries(q){ // 命运曲线数据：大运首年分 = 上一年分 + 大运分(±20/±10) + 流年分(±2/±1)；大运剩余九年分 = 上一年分 + 流年分；起运首年上一年分默认 0
  const pb=q.pb,prof=dayMasterProfile(pb);
  const series=[];let prev=0;
  q.pdayun.yun.forEach(yun=>{
    const ds=dayunScore(prof,yun.gz);
    for(let y=yun.from;y<yun.to;y++){
      const gz=gzAt(((y-4)%60+60)%60);
      const yv=yearVerdict(prof,yun.gz,gz);
      const isFirst=y===yun.from;
      const score=Math.round((prev+(isFirst?ds:0)+yv.score)*10)/10;
      series.push({y,gz,yunGz:yun.gz,age:y-pb.y,dyScore:isFirst?ds:0,liuScore:yv.score,score,grade:yv.grade,tendency:yv.dy.tendency});
      prev=score;
    }
  });
  return {series,prof};
}

/* --- 日主旺衰综合判定（纯计算） --- */
function dayMasterProfile(pb){ // 日主旺衰综合判定：得令(月令权重) + 通根(四支藏干) + 天干帮扶 + 通关，综合评分，避免"中和"
  const dg=pb.day[0],dgwx=GANWX[dg];
  const yz=ZHI[pb.monthZhi],yzwx=ZHIWX[yz];
  const elW=c=>GAN.indexOf(c)>=0?GANWX[c]:ZHIWX[c]; // 统一判断天干/地支五行
  const monthCG=ZHI_CANGGAN[yz]||[ZHI_BENQI[yz]];
  // 1) 月令权重：当令比劫+3 / 印相+2.5 / 泄食伤-2 / 耗财-1.5 / 克官杀-2.5；月支中余气藏印比微助
  let monthScore;
  if(dgwx===yzwx)monthScore=3;
  else if(SXWX[yzwx]===dgwx)monthScore=2.5;
  else if(SXWX[dgwx]===yzwx)monthScore=-2;
  else if(KXWX[dgwx]===yzwx)monthScore=-1.5;
  else monthScore=-2.5;
  for(let i=1;i<monthCG.length;i++){const w=GANWX[monthCG[i]];if(w===dgwx||SXWX[w]===dgwx)monthScore+=0.5;}
  // 2) 地支藏干五行力量（分析四个地支的藏干五行，综合日主旺衰）：比劫根本1.2/中0.8/余0.5，印星×0.5，食伤×0.5负，财×0.5负，官杀×1负；日支×1.3；月支已由月令权重计、不重复
  const zhis=[pb.year[1],pb.month[1],pb.day[1],pb.hour[1]];
  const rootDescs=[];let rootScore=0;
  zhis.forEach((z,zi)=>{
    if(zi===1)return; // 月支按月令权重计，避免重复
    const cs=ZHI_CANGGAN[z]||[ZHI_BENQI[z]];
    cs.forEach((c,ci)=>{
      const w=GANWX[c];
      const ww=(ci===0?1.2:(ci===1?0.8:0.5))*(zi===2?1.3:1);
      if(w===dgwx){rootScore+=ww;rootDescs.push(z+"("+c+"比劫)");}
      else if(SXWX[w]===dgwx){rootScore+=ww*0.5;rootDescs.push(z+"("+c+"印)");}
      else if(SXWX[dgwx]===w){rootScore-=ww*0.5;rootDescs.push(z+"("+c+"食伤)");}
      else if(KXWX[dgwx]===w){rootScore-=ww*0.5;rootDescs.push(z+"("+c+"财)");}
      else if(KXWX[w]===dgwx){rootScore-=ww;rootDescs.push(z+"("+c+"官杀)");}
    });
  });
  // 3) 天干帮扶：印比+1 / 克泄耗-1（不含日主自身，日主为坐支主体非帮扶）
  let ganScore=0,sup=0,opp=0;
  [pb.year[0],pb.month[0],pb.hour[0]].forEach(g=>{
    const w=elW(g);
    if(w===dgwx||SXWX[w]===dgwx){ganScore+=1;sup++;}else{ganScore-=1;opp++;}
  });
  // 4) 通关判断：有官杀克身且印星存在→印可化杀通关；身旺有食伤→食伤通关泄秀
  const hasSha=[pb.year[0],pb.month[0],pb.day[0],pb.hour[0],...zhis].some(ch=>KXWX[elW(ch)]===dgwx);
  const hasYin=[pb.year[0],pb.month[0],pb.day[0],pb.hour[0],...zhis].some(ch=>SXWX[elW(ch)]===dgwx);
  const hasShi=[pb.year[0],pb.month[0],pb.day[0],pb.hour[0],...zhis].some(ch=>SXWX[dgwx]===elW(ch));
  let tgTxt="无通关枢纽";
  if(hasSha&&hasYin)tgTxt="官杀克身，有印星通关，化杀生身，压力可转助力";
  else if(hasSha&&!hasYin)tgTxt="官杀克身而印星不显，压力需自扛";
  else if(rootScore>=2&&hasShi)tgTxt="身旺有食伤通关泄秀，才华可外发";
  // 5) 综合评分与等级：>=3身强；0.5~3偏旺；-3~0.5偏弱；<=-3身弱（不判中和，月令为先）
  const score=Math.round((monthScore+rootScore+ganScore)*10)/10;
  let level;
  if(score>=3)level="身强（偏旺）";
  else if(score>=0.5)level="偏旺";
  else if(score>-3)level="偏弱";
  else level="身弱（偏弱）";
  const weak=level.indexOf("弱")>=0;
  const xi=weak?"印星、比劫（生我、同我，扶身为喜）":"官杀、食伤、财星（克我、我生、我克，抑强为喜）";
  const ji=weak?"官杀、食伤、财星（克泄耗）":"印星、比劫（生扶）";
  const wxCnt={木:0,火:0,土:0,金:0,水:0};
  [pb.year[0],pb.year[1],pb.month[0],pb.month[1],pb.day[0],pb.day[1],pb.hour[0],pb.hour[1]].forEach(ch=>{
    wxCnt[elW(ch)]++;
  });
  const wxStr=Object.keys(wxCnt).map(k=>k+wxCnt[k]).join("、");
  const dlTxt=monthScore>=2.5?"得令（月支"+yz+ZHIWX[yz]+"当旺生扶日主）":"失令（月支"+yz+ZHIWX[yz]+"克泄日主，月令为退气）";
  const tgRoots=rootDescs.length?rootDescs.join("、"):"无根（四支藏干不见日主五行）";
  const text="日主"+dg+"属"+dgwx+"，生于"+yz+"月（"+ZHIWX[yz]+"），"+dlTxt+"；四支通根："+tgRoots+"；四柱五行："+wxStr+"；同党（印比）"+sup+"个、异党（克泄耗）"+opp+"个；通关："+tgTxt+"；综合旺衰评分"+score+"，判"+level+"；喜用："+xi+"；忌神："+ji+"。";
  return {dg,dgwx,yz,monthScore,rootScore,ganScore,score,level,sup,opp,xi,ji,tgTxt,rootDescs,text,weak};
}


/* ============================================================================
 * 奇门遁甲引擎（拆补法、阴盘转盘、中宫寄坤）
 * ==========================================================================*/
function getYinYangDun(term){ return YANGS.includes(term)?"阳遁":"阴遁"; }
function getYuanType(fuTouZhi){ return SHANG.includes(fuTouZhi)?"上元":(ZHONG.includes(fuTouZhi)?"中元":"下元"); }
function getJuShu(term,yuan,dun){ return JU[dun][term][{上元:0,中元:1,下元:2}[yuan]]; }
function r1DiPanPaiBu(ju,dun){ // 地盘三奇六仪
  const seq=dun==="阳遁"?LS_S.slice():LS_N.slice();
  const start=seq.indexOf(ju);
  const rot=seq.slice(start).concat(seq.slice(0,start));
  const di={};
  rot.forEach((g,i)=>{ di[g]=SANQI[i%9]; });
  return di;
}
function r2ZhiFuZhiShi(hgz,di,dun){ // 值符值使
  const xh=XUN[hgz]; const ly=xh[1];
  let lyGong=9; for(const g in di){ if(di[g]===ly){ lyGong=+g; break; } }
  const zfXing=XINGB[lyGong-1], zsMen=MENB[lyGong-1];
  const hg=hgz[0]; let hgGong=9; for(const g in di){ if(di[g]===hg){ hgGong=+g; break; } }
  let zfGong=hgGong; if(zfGong===5) zfGong=2; // 值符落中五寄坤
  const hz=hgz[1]; const ljz=ZHI.indexOf(xh[0][1]); const hzI=ZHI.indexOf(hz);
  let diff=hzI-ljz; if(diff<0) diff+=12;
  const zseq=dun==="阳遁"?LS_S:LS_N;
  const zsGongRaw=zseq[(zseq.indexOf(lyGong)+diff)%9];
  return {liuJia:xh[0],liuYi:ly,zfXing,zsMen,zfGong,zfGongRaw:hgGong,zsGong:zsGongRaw,zsGongRaw,hourGan:hg,hourZhi:hz};
}
function r3TianPanXingPai(zf,di){ // 天盘九星携仪
  const tp={};
  const zfxI=XING.indexOf(zf.zfXing==="禽"||zf.zfXing==="芮"?"芮禽":zf.zfXing);
  const zfgI=YANG.indexOf(zf.zfGong);
  YANG.forEach((g,i)=>{
    let off=i-zfgI; if(off<0) off+=8;
    const x=XING[(zfxI+off)%8];
    let xbg=XBEN[x]; if(x==="芮禽") xbg=2;
    let xie=di[xbg]; if(xbg===2) xie+=di[5];
    let dg=di[g]; if(g===2) dg=di[5]+di[2];
    tp[g]={xing:x,tg:xie,dg};
  });
  return tp;
}
function r4ShenPanPai(zfGong,dun){ // 神盘八神
  const sp={}; const sseq=dun==="阳遁"?SHEN_Y:SHEN_N;
  const sfI=YANG.indexOf(zfGong);
  YANG.forEach((g,i)=>{ sp[g]=sseq[((i-sfI)%8+8)%8]; });
  return sp;
}
function r5RenPanMenPai(zsGong,zsMen){ // 人盘八门（含门迫）
  const rp={}; const poG=[];
  const zsI=MEN.indexOf(zsMen);
  const zsgI=YANG.indexOf(zsGong===5?2:zsGong);
  YANG.forEach((g,i)=>{
    let off=i-zsgI; if(off<0) off+=8;
    const mn=MEN[(zsI+off)%8];
    rp[g]=mn;
    const mw=MENWX[mn], gw=GONGWX[g];
    if(mw&&gw&&KXWX[mw]===gw) poG.push(g);
  });
  return {rp,poG};
}
function r6TianXiangDiXiang(hgz,tp,rp){ // 天象地象
  let tianX="",tianG="",tianGN=0,diM="",diG="";
  for(const g of YANG){ if(tp[g].tg.includes(hgz[0])){ tianX=tp[g].xing; tianG=GONGNAME[g]; tianGN=g; break; } }
  diG=GONGNAME[Z2G[hgz[1]]]; diM=rp[Z2G[hgz[1]]];
  return {tianX,tianG,tianGN,diM,diG};
}
function checkRuMu(g,gong){ const z=RUMU[g]; if(z&&Z2G[z]===gong) return g+"入"+z+"墓"; }
function checkJiXing(g,gong){ const t=JIXING[g]; if(t&&t[0]===gong) return g+"刑"+t[2]+t[3]; }
function checkDeLing(g,yz){ return GANWX[g]===ZHIWX[yz]||SXWX[ZHIWX[yz]]===GANWX[g]; }

/**
 * qimenPaiPan — 主排盘函数
 * @returns  包含 tp(天盘), sp(神盘), rp(人盘), flags(标记), 值符值使落宫等完整盘面信息
 */
function qimenPaiPan(ygz,mgz,dgz,hgz,term){
  const dun=getYinYangDun(term);
  const xun=XUN[dgz];
  const yuan=getYuanType(xun[3][1]); // 按符头定三元
  const ju=getJuShu(term,yuan,dun);
  const di=r1DiPanPaiBu(ju,dun);
  const zf=r2ZhiFuZhiShi(hgz,di,dun);
  const tp=r3TianPanXingPai(zf,di);
  const sp=r4ShenPanPai(zf.zfGong,dun);
  const {rp,poG}=r5RenPanMenPai(zf.zsGong,zf.zsMen);
  const td=r6TianXiangDiXiang(hgz,tp,rp);
  const maG=Z2G[MA[zf.hourZhi]];
  const kongG=[Z2G[XUN[hgz][2][0]],Z2G[XUN[hgz][2][1]]];
  const flags={};
  for(const g of [1,8,3,4,9,2,7,6]){
    const f=[];
    if(g===zf.zfGong) f.push("符");
    if(g===zf.zsGong) f.push("使");
    if(g===maG) f.push("马");
    if(kongG.includes(g)) f.push("空");
    if(poG.includes(g)) f.push("迫");
    const yuezhi=mgz[1];
    tp[g].tg.split("").forEach(t=>{
      let rm=checkRuMu(t,g);
      if(rm){ if(checkDeLing(t,yuezhi)) rm+="库"; f.push(rm); }
      const jx=checkJiXing(t,g); if(jx) f.push(jx);
    });
    tp[g].dg.split("").forEach(t=>{
      let rm=checkRuMu(t,g);
      if(rm){ if(checkDeLing(t,yuezhi)) rm+="库"; f.push(rm); }
    });
    flags[g]=f;
  }
  return {
    pan:"转盘", qiju:"拆补", jigong:"坤",
    xunshou:zf.liuJia, liuyi:zf.liuYi, yuan, dun, ju, full:yuan+dun+ju+"局",
    zfXing:zf.zfXing, zfGong:zf.zfGongRaw===5?"中（寄坤）":GONGNAME[zf.zfGong],
    zfGongN:zf.zfGong, zfGongRaw:zf.zfGongRaw,
    zsMen:zf.zsMen, zsGong:zf.zsGongRaw===5?"中（寄坤）":GONGNAME[zf.zsGongRaw],
    zsGongN:zf.zsGongRaw===5?2:zf.zsGongRaw, zsGongRaw:zf.zsGongRaw,
    tianX:td.tianX, tianG:td.tianG, tianGN:td.tianGN, diM:td.diM, diG:td.diG,
    tp, sp, rp, flags
  };
}


/* ============================================================================
 * 梅花易数引擎
 * ==========================================================================*/
function mhMod(n,b){ const r=n%b; return r===0?b:r; }
function lookup64(upperGua,lowerGua){
  if(!upperGua||!lowerGua) return null;
  const k=upperGua.n*10+lowerGua.n;
  return MH_64[k]||null;
}

/**
 * meihuaGua — 梅花易数起卦
 * @param {Object} opts  {mode:"time|num|word", ...}
 *   time: {year, month, day, hour}
 *   num:  {n1, n2}
 *   word: {upN, downN, csIdx}   (物卦 + 方位卦 + 时辰数)
 * @returns  {up, down, ben, moveYao, huLowerGua, huUpperGua,
 *           bianLowerGua, bianUpperGua, tiGua, yongGua, upN, downN}
 */
function meihuaGua(opts){
  let upN, downN, moveYao;
  if(opts.mode==="time"){
    const yr=opts.year, mo=opts.month, da=opts.day, hr=opts.hour;
    const zhiNum=((yr-4)%12+12)%12+1;
    upN=mhMod(zhiNum+mo+da,8);
    downN=mhMod(zhiNum+mo+da+hr,8);
    moveYao=mhMod(zhiNum+mo+da+hr,6);
  }else if(opts.mode==="num"){
    const n1=Math.max(1,opts.n1||1), n2=Math.max(1,opts.n2||1);
    upN=mhMod(n1,8); downN=mhMod(n2,8); moveYao=mhMod(n1+n2,6);
  }else{
    upN=opts.upN; downN=opts.downN; moveYao=mhMod(upN+downN+(opts.csIdx||0),6);
  }
  const up=MH_GUA[upN-1], down=MH_GUA[downN-1];
  const ben=[...down.yao,...up.yao];
  // 互卦：下互 2,3,4 / 上互 3,4,5（从 1 开始数）
  const huLower=[ben[1],ben[2],ben[3]];
  const huUpper=[ben[2],ben[3],ben[4]];
  const huLowerGua=MH_GUA.find(g=>g.yao.join("")===huLower.join(""));
  const huUpperGua=MH_GUA.find(g=>g.yao.join("")===huUpper.join(""));
  // 变卦：动爻阴阳翻转
  const bian=ben.slice();
  bian[moveYao-1]=bian[moveYao-1]===1?0:1;
  const bianLower=bian.slice(0,3), bianUpper=bian.slice(3,6);
  const bianLowerGua=MH_GUA.find(g=>g.yao.join("")===bianLower.join(""));
  const bianUpperGua=MH_GUA.find(g=>g.yao.join("")===bianUpper.join(""));
  // 体用：动爻在上卦(4,5,6)→上用下体；在下卦(1,2,3)→下用下体
  const tiGua=moveYao>3?down:up;
  const yongGua=moveYao>3?up:down;
  return {up,down,ben,moveYao,huLowerGua,huUpperGua,bianLowerGua,bianUpperGua,tiGua,yongGua,upN,downN};
}


/* ============================================================================
 * 数据字典（本意 / 颜色 / 标识说明）—— 供前端 UI 弹框查询
 * ==========================================================================*/
const GANCOLOR={甲:"#2a7a3a",乙:"#2a7a3a",丙:"#c0392b",丁:"#c0392b",戊:"#b8860b",己:"#b8860b",庚:"#7a7a8a",辛:"#7a7a8a",壬:"#2a5a8a",癸:"#2a5a8a"};
const GANMEAN={甲:"元首·开端",乙:"阴木·柔和",丙:"太阳·光明",丁:"星火·希望",戊:"高山·厚重",己:"田园·蕴藏",庚:"刀剑·刚断",辛:"珠玉·精致",壬:"江河·奔流",癸:"雨露·滋润"};
const MENMEAN={休:"休养生息·机遇",生:"生发成长·吉",伤:"损伤·惊动",杜:"堵塞·保密·阻",景:"名声·文书·计划",死:"死滞·病·衰",惊:"惊恐·是非·口舌",开:"开创·通达·吉"};
const SHENMEAN={值符:"值符·核心主星",腾蛇:"虚诈·缠绕·惊扰",太阴:"隐秘·谋划·庇护",六合:"和合·交易·帮衬",白虎:"凶暴·压制·竞争",玄武:"暗昧·沉迷·蒙蔽",九地:"潜藏·阴沉·守旧",九天:"高远·张扬·变动"};
const XINGMEAN={蓬:"贪狼·冒险·奔放",任:"吉星·包容·稳固",冲:"禄存·冲动·快速",辅:"文曲·文昌·辅佐",英:"右弼·文明·光彩",芮禽:"病符·土星·平实",柱:"破军·破坏·支撑",心:"武曲·谋划·机巧"};
const FLAGMEAN={
  "符":"值符星落宫：问事核心指向，事有主、有定数",
  "使":"值使门落宫：事情的实施与动作所在",
  "马":"驿马冲动：变动、奔波、应期加速",
  "空":"旬空落宫：事未成、虚而不实，须填实方应",
  "迫":"门克宫（门迫）：行动受制、力不从心",
  "墓":"奇仪入墓：能量被藏、暂困不发",
  "刑":"奇仪击刑：主动受刑、竞争冲突",
  "库":"入墓而得令，为库而非墓：能量虽藏但不死，待时而发"
};

/* 奇门元素详细释义（八门/八神/九星长文本） */
const QM_DETAIL = {
  // --- 八门 ---
  休:"休门属水，居北方坎宫。象意：休息、退守、蓄力、贵人暗助。所问之事若临休门，主宜缓不宜急，宜守不宜攻，可借人际之力渐图进展。",
  生:"生门属土，居东北艮宫。象意：生发、求财、事业启动、子嗣。临生门主有生气、有财源，宜主动开拓、谈合作、谋发展，是求财首选之门。",
  伤:"伤门属木，居东方震宫。象意：损伤、惊动、竞争、追逐。临伤门主易有冲突、车祸、口舌、身体受伤，不宜动武、赌博、强争。",
  杜:"杜门属木，居东南巽宫。象意：堵塞、保密、隐藏、技术。临杜门主事难通、宜保密、宜退避、宜修炼技术，不宜公开活动。",
  景:"景门属火，居南方离宫。象意：名声、文书、考试、规划。临景门主文书有利、名声彰显，宜考试、策划、见贵、表演。",
  死:"死门属土，居西南坤宫。象意：死滞、殡葬、固执、衰亡。临死门主事多滞、人固执、病难愈，宜守旧、宜了结旧事，不宜新启。",
  惊:"惊门属金，居西方兑宫。象意：惊恐、口舌、官非、诉讼。临惊门主有惊恐、口舌是非、官非诉讼，宜谨慎言语、防小人。",
  开:"开门属金，居西北乾宫。象意：开创、通达、公开、就职。临开门主事业可开创、求职可成、见贵通达，是吉门之首。",
  // --- 八神 ---
  值符:"八神之首，贵人之神。象意：主贵、主统御、有领导相助、事有定论。临值符百事可为，宜见贵、谋大事。",
  腾蛇:"虚诈之神。象意：虚惊、缠绕、多梦、怪异。临腾蛇主事多反复、梦多、虚惊，宜防小人、不宜决断。",
  太阴:"荫蔽之神。象意：暗中谋划、贵人庇护、阴私之事。临太阴宜密谋、隐藏、求女人相助，不宜公开张扬。",
  六合:"和合之神。象意：婚姻、交易、合作、交友。临六合百事和合，宜谈婚、签约、合作、调解。",
  白虎:"凶暴之神。象意：凶险、丧服、争斗、血光。临白虎主有血光、争斗、疾病，宜防凶、不宜动武。",
  玄武:"盗诈之神。象意：盗失、暗昧、欺骗、淫乱。临玄武主防被骗、防盗、防泄密，不宜轻信人。",
  九地:"坚牢之神。象意：潜藏、守旧、坚固、缓慢。临九地主宜守成、缓慢、深耕，不宜快速扩张。",
  九天:"飞扬之神。象意：高远、出击、张扬、变动。临九天宜主动出击、远行、宣传，不宜固守。",
  // --- 九星 ---
  蓬:"天蓬星，贪狼水星。象意：胆大、冒险、桃花、水患。临天蓬宜大胆进取，但也主贪色、水险。",
  任:"天任星，吉星土星。象意：包容、敦厚、耕种、守成。临天任主稳健可托，宜农耕、人事、守成。",
  冲:"天冲星，禄存木星。象意：冲动、快速、动静、先声夺人。临天冲主事速发，宜速决、不宜久拖。",
  辅:"天辅星，文曲木星。象意：文昌、文教、辅佐、文雅。临天辅宜考试、教育、求师、辅佐他人。",
  英:"天英星，右弼火星。象意：文明、光彩、躁动、文艺。临天英宜表现、文书、名声，但性急。",
  芮:"天芮星，病符土星。象意：疾病、问题、学生、朋友。临天芮主有问题、疾病、需学习调理，宜求医、修学。",
  芮禽:"天芮星，病符土星。象意：疾病、问题、学生、朋友。临天芮主有问题、疾病、需学习调理，宜求医、修学。",
  柱:"天柱星，破军金星。象意：破坏、支撑、守备、守御。临天柱宜破旧立新、防守，不宜冒进。",
  心:"天心星，武曲金星。象意：谋划、医药、机巧、领导。临天心宜求医、谋划、用计，是吉星。"
};

/* 奇门辅助函数 */
function gongJudge(gan, gwxg, gwx){
  if(gwxg===gwx) return "比和得地，力量强旺";
  if(SXWX[gwxg]===gwx) return "泄于"+gwx+"，耗气";
  if(KXWX[gwxg]===gwx) return "被"+gwx+"所克，受制";
  if(SXWX[gwx]===gwxg) return "得"+gwx+"生，有气";
  return "克"+gwx+"，主动而耗";
}
function gongOverview(g){
  const m={1:"学业根基与水相关",8:"心志·受困·变动的关口",3:"行动·冲劲·竞争",4:"文昌·文思·休养",9:"前程·生机·名声",2:"母性·承载·内耗",7:"通道·阻滞·转机",6:"成果·名誉·务实"}[g];
  return m||"当下此宫";
}

/* 万物类象：梅花易数 / 奇门通用 */
const MH_WANWU={
  乾:{wx:"金",sym:"☰",groups:[
    {group:"天体",items:["天","冰","雹","霰","霞","虹","雷","云"]},
    {group:"人物",items:["父","老人","君王","名人","公门人","有权人","祖父","官贵","银行家"]},
    {group:"身体",items:["首","骨","肺","大肠","右足","命门"]},
    {group:"动物",items:["马","天鹅","狮子","虎","象","天鹅"]},
    {group:"静物",items:["金玉","宝石","钱","珠","圆物","木果","刚物","冠","镜","车辆"]},
    {group:"屋舍",items:["公廨","楼台","高堂","大厦","驿舍","西北方屋舍"]},
    {group:"方位",items:["西北","西","北"]},
    {group:"数字",items:["1","6","4","9","百","千","万"]},
    {group:"颜色",items:["大赤色","玄色","水红","木果色"]},
    {group:"时令",items:["秋天","九十月之交","戌亥月","酉时"]},
    {group:"其他",items:["刚健","武人","义勇","公门事","金玉类"]}
  ]},
  兑:{wx:"金",sym:"☱",groups:[
    {group:"天体",items:["泽","雨","泽中之物","月","星","霞"]},
    {group:"人物",items:["少女","妾","歌妓","伶人","译人","巫师","媒人","娼妓"]},
    {group:"身体",items:["舌","口","肺","痰","涎","右肋","咽喉"]},
    {group:"动物",items:["羊","泽中之物","鱼","鸡","虾","蚌"]},
    {group:"静物",items:["金刃","金类","乐器","带口之物","破旧物","瓶","钵"]},
    {group:"屋舍",items:["西向之居","近泽之居","败墙壁宅","户有损"]},
    {group:"方位",items:["正西","西"]},
    {group:"数字",items:["2","4","9","7"]},
    {group:"颜色",items:["正白","多白"]},
    {group:"时令",items:["八月","酉月","未酉戌月之交"]},
    {group:"其他",items:["毁折","缺","拆毁","附决","喜悦","妖媚"]}
  ]},
  离:{wx:"火",sym:"☲",groups:[
    {group:"天体",items:["火","日","电","虹","霞","光","热"]},
    {group:"人物",items:["中女","文人","大腹","目疾人","介胄之士","僧人","道士"]},
    {group:"身体",items:["目","心","上焦","喉","小肠","三焦"]},
    {group:"动物",items:["雉","龟","鳖","蟹","螺","蚌","飞虫"]},
    {group:"静物",items:["火","书","文","甲胄","戈兵","干燥物","红赤物","灯笼","烛"]},
    {group:"屋舍",items:["南舍","明窗","虚室","有明堂之宅"]},
    {group:"方位",items:["正南","南"]},
    {group:"数字",items:["3","9","2","7"]},
    {group:"颜色",items:["赤","紫","红","花红"]},
    {group:"时令",items:["夏天","五月","巳午月"]},
    {group:"其他",items:["明","丽","热","燥","兵戈","文书"]}
  ]},
  震:{wx:"木",sym:"☳",groups:[
    {group:"天体",items:["雷","云","青碧","山中之木"]},
    {group:"人物",items:["长男","秀士","侯","官","有声之人","运动员","司机"]},
    {group:"身体",items:["足","肝","胆","发","声音","左肋"]},
    {group:"动物",items:["龙","蛇","百虫","马鸣","竹","鹤"]},
    {group:"静物",items:["木","竹木","萑苇","乐器","花草繁鲜之物","柱","栋","竹"]},
    {group:"屋舍",items:["山林之处","竹榭","林舍","草木繁茂之所"]},
    {group:"方位",items:["正东","东"]},
    {group:"数字",items:["4","8","3","5"]},
    {group:"颜色",items:["青绿","碧绿","青"]},
    {group:"时令",items:["春天","三月","寅卯月"]},
    {group:"其他",items:["动","起","奋","迅","惊","躁","升"]}
  ]},
  巽:{wx:"木",sym:"☴",groups:[
    {group:"天体",items:["风","云","雾气","旋风","山岚","夏气"]},
    {group:"人物",items:["长女","秀士","寡发","广额","山林仙道","僧尼","道土","科技人员"]},
    {group:"身体",items:["股","肱","气","风疾","肠","神经"]},
    {group:"动物",items:["蛇","鸡","百禽","山林中之禽虫","象","鱼"]},
    {group:"静物",items:["木香","绳","直物","长物","竹木","工巧之器","风扇","飞机","舟"]},
    {group:"屋舍",items:["东南向之居","寺观楼台","山林之居","仙道之所"]},
    {group:"方位",items:["东南","东"]},
    {group:"数字",items:["5","3","8","2"]},
    {group:"颜色",items:["青绿","青","碧绿"]},
    {group:"时令",items:["春夏之交","三月","四月","辰巳月"]},
    {group:"其他",items:["入","伏","进退","利市","三倍","无臭"]}
  ]},
  坎:{wx:"水",sym:"☵",groups:[
    {group:"天体",items:["水","雨","雪","露","霜","月","沟","溪","泉"]},
    {group:"人物",items:["中男","江湖人","舟人","盗贼","亡命之人","酒家","渔夫"]},
    {group:"身体",items:["耳","肾","膀胱","血","小便","腰","脊"]},
    {group:"动物",items:["豕","鱼","水中之物","狐","鸟","鳖","蚌"]},
    {group:"静物",items:["水","子","酒","核","水带之物","轮","弓","轮轴","黑色物"]},
    {group:"屋舍",items:["向北之居","近水","楼阁","江楼","河宅","水阁"]},
    {group:"方位",items:["正北","北"]},
    {group:"数字",items:["1","6","5","0"]},
    {group:"颜色",items:["黑","白","深灰"]},
    {group:"时令",items:["冬天","十一月","子月","亥月"]},
    {group:"其他",items:["陷","险","隐伏","困","酒","水"]}
  ]},
  艮:{wx:"土",sym:"☶",groups:[
    {group:"天体",items:["山","云","雾","山径","山路","土"]},
    {group:"人物",items:["少男","闲人","山中人","童子","小孩","守卫","儿童"]},
    {group:"身体",items:["手","指","鼻","骨","皮肉","脾","背"]},
    {group:"动物",items:["狗","鼠","百兽","黔喙之属","鹿","狼","熊"]},
    {group:"静物",items:["土石","瓜果","黄物","土中之物","木生之物","藤生之瓜"]},
    {group:"屋舍",items:["东北方之居","山居","近石","近路之宅","安宅","坟墓"]},
    {group:"方位",items:["东北","东北方"]},
    {group:"数字",items:["5","7","10","8"]},
    {group:"颜色",items:["黄","黑","棕"]},
    {group:"时令",items:["冬春之月","十二月","丑寅月"]},
    {group:"其他",items:["止","持","阻","成","蓄","守"]}
  ]},
  坤:{wx:"土",sym:"☷",groups:[
    {group:"天体",items:["地","阴","云","雾气","冰霜","沙","平"]},
    {group:"人物",items:["母","后","农夫","乡人","众人","老妇","妻","腹疾人"]},
    {group:"身体",items:["腹","脾","胃","肉","臀部","大肠"]},
    {group:"动物",items:["牛","百兽","牝马","雌兽","蜂","蚁","类"]},
    {group:"静物",items:["方物","柔物","布帛","丝绵","五谷","舆","釜","瓦器","灰"]},
    {group:"屋舍",items:["西南方之居","村居","田舍","矮屋","土阶","仓库"]},
    {group:"方位",items:["西南","西南角"]},
    {group:"数字",items:["5","8","10","2"]},
    {group:"颜色",items:["黄","黑","瓦灰"]},
    {group:"时令",items:["辰戌丑未月","四季土","六月","七月"]},
    {group:"其他",items:["顺","布","藏","吝","柔","众","闭"]}
  ]}
};


/* ============================================================================
 * 梅花易数 · 通用常量 & 工具函数（analysis.html / xiaoxuan.html 共用）
 * 注意：主题相关常量（如五行颜色 MH_WXCOLOR）不在此定义，
 *       由各页面根据自己的 UI 主题自行定义（xiaoxuan 暗色紫 / analysis 亮色）。
 * ==========================================================================*/

/* --- 体用关系辅助 --- */
const MH_ROLE_DESC={
  "体":"求测人自身状态与禀赋",
  "用":"所问事态本身（财运/事业/健康）",
  "上互":"中间过程的外部环境",
  "下互":"中间过程的内部基础",
  "上变":"最终结果的外部趋势",
  "下变":"最终结果的内部根基"
};
/**
 * 五行生克关系（用于卦象卡片标注）
 * @param {string} targetWx  目标卦五行
 * @param {string} tiWx      体卦五行
 * @returns {"比和" | "体生用·泄" | "用生体·生" | "体克用·耗" | "用克体·克" | ""}
 */
function mhWxRel(targetWx, tiWx){
  if(typeof SXWX === 'undefined') return '';
  if(targetWx===tiWx) return "比和";
  if(SXWX[tiWx]===targetWx) return "体生用·泄";
  if(SXWX[targetWx]===tiWx) return "用生体·生";
  if(KXWX[tiWx]===targetWx) return "体克用·耗";
  if(KXWX[targetWx]===tiWx) return "用克体·克";
  return "";
}

/* --- 物卦起例（梅花易数古法） --- */
/** 随机起例：描述事物+方位的短句 */
const MH_WUGUA_WORDS=[
  "看见一只黑猫从东边窜过",
  "西边窗户的风铃无风自动",
  "北边路上一位老人跌倒又爬起",
  "南方天空忽然劈下一道闪电",
  "东北方竹林里传来三声鸟鸣",
  "西南方向飘来一阵花香",
  "西北方有只白鹤落在屋顶",
  "东南角的海棠花一夜之间全开了",
  "出门见一辆红色汽车从西边驶过",
  "北边湖面浮现一轮圆月倒影",
  "东方传来寺庙的三声钟声",
  "南边的茶水杯自己倒了却没有碎",
  "西北方的竹子被风吹弯又直",
  "西南方蚂蚁成群往高处搬家",
  "东边的路灯闪了三下才稳定",
  "捡到一枚铜钱正面朝上，在北边路口",
  "东北角闻到一股淡淡的檀香味",
  "南边手机屏幕闪了三下才亮起",
  "一阵风从西边吹来把门吹开",
  "雨后天边一道彩虹横跨南北"
];
/** 十二时辰：子1 丑2 ... 亥12 */
const CHENSHI_12=[
  {idx:1,name:"子",range:"23-1点"},
  {idx:2,name:"丑",range:"1-3点"},
  {idx:3,name:"寅",range:"3-5点"},
  {idx:4,name:"卯",range:"5-7点"},
  {idx:5,name:"辰",range:"7-9点"},
  {idx:6,name:"巳",range:"9-11点"},
  {idx:7,name:"午",range:"11-13点"},
  {idx:8,name:"未",range:"13-15点"},
  {idx:9,name:"申",range:"15-17点"},
  {idx:10,name:"酉",range:"17-19点"},
  {idx:11,name:"戌",range:"19-21点"},
  {idx:12,name:"亥",range:"21-23点"}
];
/** 方位→先天卦数（梅花易数古法） */
const FANGWEI_GUA={
  "东":4,"东南":5,"南":3,"西南":8,"西":2,"西北":1,"北":6,"东北":7
};
/** 从方位描述中提取方卦数 */
function parseFangweiGua(text){
  if(!text) return 1+Math.floor(Math.random()*8);
  for(const [fw,n] of Object.entries(FANGWEI_GUA)){
    if(text.includes(fw)) return n;
  }
  return 1+Math.floor(Math.random()*8); /* 找不到则随机 */
}
/** 从时辰索引获取当前时辰（hour: 0-23） */
function getChenshiFromHour(hour){
  /* 23-1 子, 1-3 丑, 3-5 寅, 5-7 卯, 7-9 辰, 9-11 巳, 11-13 午, 13-15 未, 15-17 申, 17-19 酉, 19-21 戌, 21-23 亥 */
  if(hour>=23||hour<1) return 1;
  return Math.floor((hour+1)/2)+1; /* hour 1,2→丑2; 3,4→寅3; ... */
}

/* --- 万物类象 localStorage 工具 --- */
function wanwuKey(cacheId){ return "mh_wanwu_"+cacheId; }
function wanwuGet(cacheId){
  try{ return JSON.parse(localStorage.getItem(wanwuKey(cacheId))||"[]"); }catch(e){ return []; }
}
function wanwuSet(cacheId,arr){
  localStorage.setItem(wanwuKey(cacheId), JSON.stringify(arr||[]));
}


/* ============================================================================
 * 挂载：所有函数 / 常量 注册到 window，
 *       同时注册 XQ_ 前缀别名，兼容 xiaoxuan.html 中遗留的旧引用（无遗留了）。
 * ==========================================================================*/
(function(){
  const _keys = Object.keys(typeof window !== "undefined" && window ? window : globalThis);
  const _as = {};
  // 收集当前文件定义的所有顶层 const / function
  // （靠命名约定：xQ_xxx 前缀 / XQ_xxx 前缀 已移除，现在直接用原始名字）
})();
// 说明：所有代码均以顶层 const/function 声明形式存在，
// 浏览器默认自动挂到 window，无需额外赋值。

/* ============================================================================
 * 共享：档案（用户档案）通用逻辑 —— analysis.html 与 xiaoxuan.html 共用
 *   两页面此前的 RELATION_MAP / _archives / closeArchiveEditor 完全重复，
 *   现统一收敛到本文件，页面只需在开头引用 yishu.js 即可。
 * ==========================================================================*/
/** 六亲/关系字典（两页面共用；为超集，含各自所用键） */
const RELATION_MAP={
  self:"自己", spouse:"配偶", child:"子女", parent:"父母", sibling:"兄弟姐妹",
  grandparent:"祖辈", grandchild:"孙辈", friend:"朋友", colleague:"同事",
  classmate:"同学", teacher:"老师", student:"学生", other:"其他"
};
/** 缓存所有档案的共享全局容器 */
let _archives=[];
/** 关闭档案编辑面板 */
function closeArchiveEditor(){
  const editor=document.getElementById("archiveEditor");
  if(editor) editor.style.display="none";
}

/* ============================================================================
 * 小程序适配：CommonJS 导出（仅在 mini program 的模块环境生效）
 * ----------------------------------------------------------------------------
 * 浏览器里没有 module 对象，`typeof module !== "undefined"` 恒为 false，
 * 因此下面整块对 xiaoxuan.html / analysis.html 完全无副作用。
 * 小程序端由 uniApp/utils/yishu.js 适配层 require 本文件后取用。
 * 本文件是 qimen-1/static/yishu.js 的复制件，改动请先改网页版再同步过来。
 * ==========================================================================*/
if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    /* --- 常量 / 字典 --- */
    YANGS, SHANG, ZHONG, JU, MA, GAN, ZHI, JQ, YANG, SANQI, XING, XINGB, MEN, MENB,
    SHEN_Y, SHEN_N, LS_S, LS_N, GONGNAME, Z2G, XUN, KXWX, SXWX, MENWX, GONGWX,
    GANWX, ZHIWX, JIXING, RUMU, XBEN, MH_GUA, MH_64, MH_ZHI_NUM, ZHI_BENQI, ZHI_CANGGAN,
    GANCOLOR, GANMEAN, MENMEAN, SHENMEAN, XINGMEAN, FLAGMEAN, QM_DETAIL,
    MH_WANWU, MH_ROLE_DESC, MH_WUGUA_WORDS, CHENSHI_12, FANGWEI_GUA, RELATION_MAP,
    /* --- 历法 --- */
    jdFromDate, julianToGregorian, dayGZ, gzAt, sunLongitude, termLong, findTermTime,
    jdToDate, getSolarTerm,
    /* --- 四柱八字 --- */
    getBazi, gzToIdx, calcDayun, wxRel, ganRel, zhiRel,
    yunScoreParts, yunScore, gzGood, dayunScore, liunianScore, dayunTendency,
    yearVerdict, fmtScore, calcFateSeries, dayMasterProfile,
    /* --- 奇门遁甲 --- */
    getYinYangDun, getYuanType, getJuShu, r1DiPanPaiBu, r2ZhiFuZhiShi, r3TianPanXingPai,
    r4ShenPanPai, r5RenPanMenPai, r6TianXiangDiXiang, checkRuMu, checkJiXing, checkDeLing,
    qimenPaiPan, gongJudge, gongOverview,
    /* --- 梅花易数 --- */
    mhMod, lookup64, meihuaGua, mhWxRel, parseFangweiGua, getChenshiFromHour,
    wanwuKey, wanwuGet, wanwuSet
  };
}
