(()=>{
  // Preserve the browser history: Back/Forward must move one navigation at a time.
  // Only consume the Drive return marker; do not redirect restored pages to Home.
  try {
    const raw=sessionStorage.getItem('rc_drive_return_pending');
    if(raw){
      const p=JSON.parse(raw);
      if(!p?.hash||p.hash===location.hash)sessionStorage.removeItem('rc_drive_return_pending');
    }
  }catch{}
})();
