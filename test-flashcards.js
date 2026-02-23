const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('pageerror', error => console.error('PAGE ERROR:', error));
  page.on('console', msg => {
      if(msg.type() === 'error') console.error('CONSOLE ERROR:', msg.text());
  });
  
  await page.goto('http://127.0.0.1:8000/dashboard.html?user=daiyihang');
  await page.waitForTimeout(1000);
  console.log('Setting subject to 经济学');
  await page.selectOption('#subjectFilter', '经济学');
  await page.waitForTimeout(500);
  console.log('Setting topic to 经济学_w3.json');
  await page.selectOption('#topicSelector', '经济学_w3.json');
  await page.waitForTimeout(1000);
  
  const text = await page.locator('#progressText').innerText();
  console.log('Progress is:', text);
  await browser.close();
})();
