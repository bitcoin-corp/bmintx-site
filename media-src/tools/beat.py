import sys,subprocess,numpy as np
f=sys.argv[1]; sr=11025
pcm=np.frombuffer(subprocess.run(['ffmpeg','-v','error','-i',f,'-ac','1','-ar',str(sr),'-f','s16le','-'],capture_output=True).stdout,np.int16).astype(float)
hop=256; n=len(pcm)//hop
e=np.array([np.sum(pcm[i*hop:(i+1)*hop]**2) for i in range(n)]); le=np.log1p(e)
on=np.maximum(0,np.diff(le,prepend=le[0])); fps=sr/hop
# energy per 5s window -> find best 32s window
win=int(32*fps); cs=np.cumsum(e); best=max(range(0,n-win,int(fps)),key=lambda i:cs[i+win]-cs[i])
# tempo
o=on-on.mean(); ac=np.correlate(o,o,'full')[len(o)-1:]
lags=np.arange(int(fps*60/180),int(fps*60/80)); L=lags[np.argmax(ac[lags])]; bpm=60*fps/L
# phase
ph=max(range(L),key=lambda p:on[p::L].sum()); first=ph/fps
print(f"bpm={bpm:.1f} beat={L/fps:.4f}s phase={first:.3f} loudest32s_start={best/fps:.1f}")
