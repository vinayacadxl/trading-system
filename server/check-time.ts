async function checkTime() {
    const start = Date.now();
    const res = await fetch('https://api.india.delta.exchange/v2/products');
    const end = Date.now();
    const serverTimeHeader = res.headers.get('date');
    const serverTime = serverTimeHeader ? new Date(serverTimeHeader).getTime() : 0;
    console.log(`Local Time (Start): ${start}`);
    console.log(`Server Time (Header): ${serverTime}`);
    console.log(`Diff: ${serverTime - start} ms`);
    process.exit(0);
}
checkTime();
