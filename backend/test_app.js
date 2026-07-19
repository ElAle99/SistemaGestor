const http = require('http');

http.get('http://localhost:3000/gestor/app.js', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    try {
      require('vm').runInNewContext(data, {
        window: {}, document: {
          getElementById: () => ({ addEventListener: () => {}, classList: { add: ()=>{}, remove: ()=>{} } }),
          querySelectorAll: () => [],
          querySelector: () => ({ innerHTML: '' }),
          addEventListener: () => {}
        },
        sessionStorage: { getItem: () => null, setItem: () => {} },
        console: console,
        fetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve([]) }),
        alert: console.log,
        BASE_API_URL: 'http://localhost:3000/api',
        APP_STATE: { cart: [], inventario: [], ordenes: [], eventos: [], clientes: [], ventas: [], cotizaciones: [] },
        FullCalendar: { Calendar: class { render(){} } },
        Chart: class { constructor(){} destroy(){} }
      });
      console.log("No syntax or immediate runtime errors in top-level app.js execution");
    } catch (e) {
      console.error("VM RUNTIME ERROR:", e);
    }
  });
}).on("error", (err) => {
  console.log("Error: " + err.message);
});
