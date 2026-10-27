import {defineConfig,devices} from "@playwright/test";

export default defineConfig({
  testDir:"./tests/e2e",
  fullyParallel:true,
  forbidOnly:Boolean(process.env.CI),
  retries:process.env.CI?2:0,
  workers:process.env.CI?1:undefined,
  reporter:process.env.CI?"line":"list",
  use:{
    baseURL:process.env.THRYNT_E2E_BASE_URL??"https://thrynt.vercel.app",
    trace:"retain-on-failure",
    screenshot:"only-on-failure",
    video:"retain-on-failure",
  },
  projects:[
    {name:"desktop",use:{...devices["Desktop Chrome"]}},
    {name:"mobile",use:{...devices["Pixel 5"]}},
  ],
});
