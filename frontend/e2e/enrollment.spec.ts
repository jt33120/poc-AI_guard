import { expect, test } from "@playwright/test";
import { WORKSPACE } from "./workspace-fixture";

test("confirmation resumes after authentication without losing its device code", async ({page}) => {
  await page.goto("/extensions/connect?code=ABCDE-23456");
  await expect(page).toHaveURL(/\/login\?next=/);
  expect(new URL(page.url()).searchParams.get("next")).toBe("/extensions/connect?code=ABCDE-23456");
});

for (const width of [390, 1440]) {
  test(`an admin confirms the organization and identifies a workstation at ${width}px`, async ({page}, testInfo) => {
    await page.setViewportSize({width,height:1000});
    await page.context().addCookies([{name:"xsom_e2e",value:"1",url:"http://127.0.0.1:3100"}]);
    let confirmed: Record<string,unknown> | undefined;
    await page.route("**/api/control/**", async route => {
      const url=new URL(route.request().url());
      if(url.pathname.endsWith("/workspace")) return route.fulfill({json:WORKSPACE});
      if(url.pathname.endsWith("/enrollment")) {
        if(route.request().method()==="POST") { confirmed=route.request().postDataJSON(); return route.fulfill({json:{device_id:"test-mac"}}); }
        return route.fulfill({json:{platform:"darwin",extension_version:"0.6.2",expires_at:"2099-01-01T15:00:00Z"}});
      }
      if(url.pathname.endsWith("/devices")) return route.fulfill({json:confirmed ? [{id:"test-mac",name:confirmed.name,member_label:confirmed.member_label,team:confirmed.team,platform:"darwin",extension_version:"0.6.2",mode:"block",registered_at:new Date().toISOString(),last_seen_at:new Date().toISOString(),revoked_at:null,gateway_events:0,presence:"recent"}] : []});
      return route.fulfill({json:url.pathname.endsWith("/events")?{events:[],next_before:null}:[]});
    });
    await page.goto("/extensions/connect?code=ABCDE-23456");
    await expect(page.getByLabel("Code de l’extension")).toHaveValue("ABCDE-23456");
    await page.getByRole("button",{name:"Vérifier le code"}).click();
    await expect(page.getByText("macOS · v0.6.2")).toBeVisible();
    expect(confirmed).toBeUndefined();
    await page.getByLabel("Nom du poste",{exact:true}).fill("Mac de test");
    await page.getByLabel("Membre — facultatif").fill("Julian test");
    await page.getByLabel("Équipe — facultatif").fill("Produit test");
    await page.screenshot({path:testInfo.outputPath(`confirm-${width}.png`),fullPage:true});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.getByRole("button",{name:"Confirmer le rattachement"}).click();
    expect(confirmed).toEqual({code:"ABCDE-23456",name:"Mac de test",member_label:"Julian test",team:"Produit test"});
    await expect(page.getByRole("heading",{name:"Poste enregistré",exact:true})).toBeVisible();
    await page.getByRole("link",{name:"Voir les postes de l’équipe"}).click();
    await expect(page.locator(".console-panel").getByText("Mac de test",{exact:true}).first()).toBeVisible();
    await expect(page.getByText("Julian test · Produit test",{exact:true})).toBeVisible();
    await expect(page.locator(".workspace-presence").filter({hasText:"Contact récent"})).toBeVisible();
    await expect(page.getByText("Enregistré · trafic non attesté",{exact:true})).toBeVisible();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
    await page.screenshot({path:testInfo.outputPath(`device-${width}.png`),fullPage:true});
  });
}

test("an expired code cannot reach the confirmation form", async ({page}) => {
  await page.context().addCookies([{name:"xsom_e2e",value:"1",url:"http://127.0.0.1:3100"}]);
  await page.route("**/api/control/v1/workspace",r=>r.fulfill({json:WORKSPACE}));
  await page.route("**/api/control/v1/extensions/enrollment?*",r=>r.fulfill({status:410,json:{detail:"expired"}}));
  await page.goto("/extensions/connect?code=ABCDE-23456");
  await page.getByRole("button",{name:"Vérifier le code"}).click();
  await expect(page.getByRole("button",{name:"Confirmer le rattachement"})).toHaveCount(0);
  await expect(page.getByText("Un code expiré ou déjà confirmé nécessite de relancer le raccordement depuis l’extension.")).toBeVisible();
});
