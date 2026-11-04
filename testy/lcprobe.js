const urls = [
  'https://services.terrascope.be/wmts/v2?layer=WORLDCOVER_2021_MAP&style=&tilematrixset=EPSG:3857&Service=WMTS&Request=GetTile&Version=1.0.0&Format=image/png&TileMatrix=EPSG:3857:10&TileCol=568&TileRow=350',
  'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N48E018_Map.tif',
  '/dem/terrarium/2/2/1.png',
];
const out = [];
for (const u of urls) {
  try {
    const r = await fetch(u, { headers: u.endsWith('.tif') ? { Range: 'bytes=0-1023' } : {} });
    const b = await r.arrayBuffer();
    out.push(`${r.status} ${r.headers.get('content-type')} ${b.byteLength} B  ${u.slice(0, 70)}`);
  } catch (e) { out.push(`BŁĄD ${e.message}  ${u.slice(0, 70)}`); }
}
log('\n' + out.join('\n'));
