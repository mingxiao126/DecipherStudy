const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  await page.goto('http://127.0.0.1:8000/dashboard.html?user=daiyihang');
  await page.waitForTimeout(1000);
  
  // Select "统计学"
  await page.selectOption('#subjectFilter', '统计学');
  await page.waitForTimeout(500);
  
  // Get all options in topicSelector
  const topics = await page.$$eval('#topicSelector option', opts => opts.map(o => o.text));
  console.log('Topics for 统计学:', topics);
  
  await browser.close();
})();
