import json, sys, numpy as np, base64, os
src, mode, out = sys.argv[1], sys.argv[2], sys.argv[3]
m = json.load(open(os.path.join(src,'model.json')))
man = m['weightsManifest']
assert len(man)==1
buf = b''.join(open(os.path.join(src,p),'rb').read() for p in man[0]['paths'])
off=0; newspecs=[]; parts=[]
stats={}
for w in man[0]['weights']:
    n=int(np.prod(w['shape'])) if w['shape'] else 1
    dt=w['dtype']; assert 'quantization' not in w
    size={'float32':4,'int32':4,'bool':1}[dt]*n
    raw=buf[off:off+size]; off+=size
    s=dict(w)
    if dt=='float32' and mode!='f32':
        a=np.frombuffer(raw,np.float32)
        if mode=='f16':
            parts.append(a.astype(np.float16).tobytes())
            s['quantization']={'dtype':'float16','original_dtype':'float32'}
        else:
            mn=float(a.min()); mx=float(a.max())
            scale=(mx-mn)/255.0 if mx>mn else 1.0
            q=np.round((a-mn)/scale).clip(0,255).astype(np.uint8)
            parts.append(q.tobytes())
            s['quantization']={'dtype':'uint8','min':mn,'scale':scale,'original_dtype':'float32'}
    else:
        parts.append(raw)
    stats[dt]=stats.get(dt,0)+1
    newspecs.append(s)
assert off==len(buf),(off,len(buf))
data=b''.join(parts)
js = ('window.SSD_MODEL={topology:%s,specs:%s,b64:"%s"};' % (json.dumps(m['modelTopology'],separators=(',',':')), json.dumps(newspecs,separators=(',',':')), base64.b64encode(data).decode()))
open(out,'w').write(js)
print(mode, stats, 'weights bytes', len(data), 'js bytes', len(js))
