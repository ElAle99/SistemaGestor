const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch({headless: 'new'});
  const page = await browser.newPage();
  
  page.on('console', msg => {
      console.log('BROWSER LOG [', msg.type(), ']:', msg.text());
  });
  
  page.on('pageerror', error => {
      console.log('BROWSER PAGE ERROR:', error.message);
  });
  
  await page.goto('http://localhost:3000/gestor/');
  await page.waitForTimeout(1000);
  
  // Try to login
  await page.type('#login-email', 'allfixbacalar');
  await page.type('#login-password', 'Bacalar1');
  await page.click('#btn-login-submit');
  
  console.log('Clicked login...');
  await page.waitForTimeout(2000);
  
  // Go to POS
  console.log('Going to POS...');
  const posLink = await page.$('a[data-view="pos"]');
  if (posLink) await posLink.click();
  await page.waitForTimeout(1000);
  
  // Vaciar carrito
  console.log('Clicking vaciar carrito...');
  const btnClear = await page.$('#btn-pos-clear');
  if (btnClear) await btnClear.click();
  
  await browser.close();
  console.log('Test completed.');
})();
