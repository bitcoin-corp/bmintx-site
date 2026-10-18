import sys,subprocess,os
from PIL import Image
src,out,cols=sys.argv[1],sys.argv[2],int(sys.argv[3]); ts=[float(x) for x in sys.argv[4].split(',')]
ims=[]
for t in ts:
    p=f'{out}.{t}.jpg'; subprocess.run(['ffmpeg','-v','error','-ss',str(t),'-i',src,'-frames:v','1','-update','1','-strict','unofficial','-y',p]); ims.append(Image.open(p))
w=480; h=int(w*ims[0].height/ims[0].width); S=Image.new('RGB',(w*cols,h*((len(ims)+cols-1)//cols)))
for k,im in enumerate(ims): S.paste(im.resize((w,h)),((k%cols)*w,(k//cols)*h))
S.save(out,quality=85)
