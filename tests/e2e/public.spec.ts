import {expect,test,type Page} from "@playwright/test";

const screens=["Overview","Strategy Studio","Markets","Live Pulse","Positions & Risk","Decision Trace","Settings"] as const;
const apiBase=process.env.THRYNT_E2E_API_URL??"https://thrynt.delealufejoel.workers.dev";

async function openScreen(page:Page,name:string) {
  const nav=page.getByRole("button",{name,exact:true});
  const openNavigation=page.getByRole("button",{name:"Open navigation",exact:true});
  // On narrow viewports the sidebar button can remain visibility-true while
  // its drawer is translated off-canvas. Open the drawer explicitly before
  // interacting with any navigation item.
  if(await openNavigation.isVisible())await openNavigation.click();
  await nav.scrollIntoViewIfNeeded();
  await nav.click();
  await expect(page.getByRole("heading",{name,exact:true})).toBeVisible();
}

test.describe("public THRYNT shell",()=>{
  test("guest can inspect all seven screens without owner mutation",async({page})=>{
    await page.goto("/");
    await expect(page.getByRole("heading",{name:"Overview",exact:true})).toBeVisible();
    for(const screen of screens)await openScreen(page,screen);

    await openScreen(page,"Strategy Studio");
    await expect(page.getByRole("button",{name:/^Save (draft|new version)$/}).first()).toBeDisabled();
    await expect(page.getByText("Sign in as the approved trader under Settings to save or arm a rule.")).toBeVisible();
  });

  test("guest navigation remains keyboard reachable",async({page})=>{
    await page.goto("/");
    const markets=page.getByRole("button",{name:"Markets",exact:true});
    if(!(await markets.isVisible()))await page.getByRole("button",{name:"Open navigation",exact:true}).click();
    await markets.press("Enter");
    await expect(page.getByRole("heading",{name:"Markets",exact:true})).toBeVisible();
  });

  test("positions screen labels the owner-assisted protection boundary",async({page})=>{
    await page.goto("/");
    await openScreen(page,"Positions & Risk");
    await expect(page.getByRole("heading",{name:"Owner-held protection workflow",exact:true})).toBeVisible();
    await expect(page.getByText(/THRYNT never requests or stores that private key/)).toBeVisible();
    await expect(page.getByText(/opposite-side IOC/)).toBeVisible();
  });

  test("owner API rejects anonymous and malformed bearer credentials",async({request})=>{
    const anonymous=await request.get(`${apiBase}/v1/owner/strategies`);
    expect(anonymous.status()).toBe(401);
    const malformed=await request.get(`${apiBase}/v1/owner/strategies`,{
      headers:{Authorization:"Bearer not-a-jwt"},
    });
    expect(malformed.status()).toBe(401);
  });
});

test.describe("approved trader smoke path",()=>{
  test.skip(!process.env.THRYNT_E2E_STORAGE_STATE,"Set THRYNT_E2E_STORAGE_STATE to run the owner-session smoke test");

  test("approved session exposes owner controls but no signing key",async({browser})=>{
    const context=await browser.newContext({storageState:process.env.THRYNT_E2E_STORAGE_STATE});
    const page=await context.newPage();
    await page.goto("/");
    await openScreen(page,"Settings");
    await expect(page.getByText("Signed in",{exact:true})).toBeVisible();
    await openScreen(page,"Strategy Studio");
    await expect(page.getByRole("button",{name:/^Save (draft|new version)$/}).first()).toBeEnabled();
    await expect(page.getByText("No private key is ever entered in this website")).toBeVisible();
    await context.close();
  });
});
