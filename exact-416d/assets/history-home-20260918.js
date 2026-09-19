(()=>{
const driveReturn=()=>{try{const raw=sessionStorage.getItem('rc_drive_return_pending');if(!raw)return false;const p=JSON.parse(raw);const sameHash=!p?.hash||p.hash===location.hash; if(sameHash)sessionStorage.removeItem('rc_drive_return_pending');return sameHash;}catch{return false;}};
const goHome=()=>{try{if(location.pathname==='/'&&!location.hash&&!location.search)return;location.replace(location.origin+'/');}catch{location.href=location.origin+'/';}};
let nav='navigate';try{nav=performance.getEntriesByType('navigation')[0]?.type||'navigate';}catch{}
const returningFromDrive=driveReturn();
if(nav==='back_forward'&&!returningFromDrive)goHome();
window.addEventListener('pageshow',e=>{if(e.persisted&&!driveReturn())goHome();});
})();
