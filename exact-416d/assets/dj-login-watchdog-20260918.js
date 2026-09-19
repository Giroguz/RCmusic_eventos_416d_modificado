(()=>{
const key='rc_dj_login_watchdog_retry_v1';
function check(){
  if(location.hash!=='#dj-login')return;
  const root=document.getElementById('root');
  if(!root)return;
  if(root.textContent.trim()){try{sessionStorage.removeItem(key)}catch{};return}
  let retried=false;try{retried=sessionStorage.getItem(key)==='1'}catch{}
  if(!retried){try{sessionStorage.setItem(key,'1')}catch{};location.reload();}
}
setTimeout(check,1800);setInterval(check,1800);
})();