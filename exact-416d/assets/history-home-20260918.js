(()=>{
const goHome=()=>{try{if(location.pathname==='/'&&!location.hash&&!location.search)return;location.replace(location.origin+'/');}catch{location.href=location.origin+'/';}};
let nav='navigate';try{nav=performance.getEntriesByType('navigation')[0]?.type||'navigate';}catch{}
if(nav==='back_forward')goHome();
window.addEventListener('pageshow',e=>{if(e.persisted)goHome();});
})();