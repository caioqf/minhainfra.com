import sys, json, time, urllib.parse, urllib.request, http.cookiejar, os
B="https://app4.cidades.gov.br/serieHistorica/"
H={"User-Agent":"Mozilla/5.0 (Macintosh) Chrome/124","X-Requested-With":"XMLHttpRequest"}
out=sys.argv[1]; anos=sys.argv[2].split(',')
# fk_glossario ids -> familia
CAMPOS={"4":["38997","39397","39394"],            # AG001 AG002 AG003
        "6":["39298","39322","38686","39041","39314","38668","38658","38874","38661"], # QD002 QD003 QD004 QD015 QD021 QD022 QD023 QD024 QD025
        "12":["38720","38445","38327","38746","38241"], # IN071..IN074, IN083
        "8":["38747"], "9":["38235","38744"]}     # IN005 ; IN049 IN055
cj=http.cookiejar.CookieJar(); op=urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))
def post(path, data, t=600):
    body=data if isinstance(data,str) else urllib.parse.urlencode(data, doseq=True)
    r=op.open(urllib.request.Request(B+path, data=body.encode(), headers=H), timeout=t)
    j=json.loads(r.read()); j.pop('debug',None); return j
post("consolidadoMunicipio/index", {"ajax":1})
mun=post("consolidadoMunicipio/getSelectOpt", {"ajax":1,"action":"","element":"cod_mun"})
codes=[c for g in mun['arrSelect']['cod_mun'].values() for c in g]
print("municipios", len(codes), file=sys.stderr)
cols=[("ShMunicipios[cod_fam_info][]",f) for f in CAMPOS]+[("ShMunicipios[fk_glossario][]",c) for v in CAMPOS.values() for c in v]
for ano in anos:
    dest=os.path.join(out, f"snis_serie_historica_{ano}.csv")
    if os.path.exists(dest): continue
    pairs=[("ShMunicipios[tipo_info][]","1"),("ShMunicipios[ano_ref][]",ano)]+[("ShMunicipios[cod_mun][]",c) for c in codes]
    data=urllib.parse.urlencode(pairs)+"&"+urllib.parse.urlencode(cols)
    cfg=post("consolidadoMunicipio/getGridConfig", {"ajax":1,"data":data,"starting":1,"search-id":""})
    n=0
    while 'isFinished' not in cfg and n<30:
        cfg=post("consolidadoMunicipio/getGridConfig", {"ajax":1,"search-id":cfg.get('search-id','')}); n+=1
    colnames=cfg.get('colNames')
    rel=post("relatorio/RelconsolidadoMunicipio", {"ajax":1,"data":data,"sidx":"a.sgl_est,a.nom_mun,a.ano_ref","sord":"asc","search-id":cfg.get('search-id','')})
    if rel.get('status')!='ok': print(ano, "ERRO", rel, file=sys.stderr); continue
    raw=op.open(urllib.request.Request(B+rel['nameRel'].replace('\\','/'), headers=H), timeout=600).read()
    txt=raw.decode('utf-16')
    lines=[l for l in txt.splitlines() if l.strip() and l.strip()!='""']
    with open(dest,'w',encoding='utf-8') as f:
        if False: f.write(";".join(c for c in colnames if c!='')+"\n")
        f.write("\n".join(lines)+"\n")
    print(ano, len(lines), "linhas;", "colNames:", colnames, file=sys.stderr)
    time.sleep(1)
