import {useEffect,useState} from 'react';
import {createFileRoute,notFound} from '@tanstack/react-router';
import {ShadowTrialPanel} from '@/features/shadow-trial/shadow-trial-panel';
import {shadowHostEnabled} from '@/features/shadow-trial/shadow-trial-policy';
import {shadowTrialFlag as flag} from '@/features/shadow-trial/shadow-trial-feature';
// Existing root route supplies the normal WalletProviders. No new wallet host.
export const Route=createFileRoute('/dev/shadow-trial')({
  beforeLoad:()=>{if(flag!=='true')throw notFound();if(typeof window!=='undefined'&&!shadowHostEnabled(flag,window.location.origin))throw notFound();},
  component:ShadowTrialRoute,
});
function ShadowTrialRoute(){
  const [allowed,setAllowed]=useState(false);
  useEffect(()=>{setAllowed(shadowHostEnabled(flag,window.location.origin));},[]);
  return allowed?<ShadowTrialPanel/>:null;
}
