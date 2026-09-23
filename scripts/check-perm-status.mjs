import * as lark from "@larksuiteoapi/node-sdk";

const appId = "cli_aa1cf4558ef89ccd";
const appSecret = "9AtDFdbPk5JpFr97TNzXShU6Sfj0wTpm";

const client = new lark.Client({
  appId,
  appSecret,
  appType: lark.AppType.SelfBuild,
  domain: lark.Domain.Feishu,
});

async function main() {
  const testId = "ou_ef6185a68a678c65de23257e3d76e7cf";
  try {
    const res = await client.contact.user.get({
      path: { user_id: testId },
      params: { user_id_type: "open_id" },
    });
    console.log("Check name field:", res.data?.user?.name || "NOT_YET_ACTIVE");
    if (res.data?.user?.name) {
      console.log("🎉 飞书新权限已成功生效！名字为:", res.data.user.name);
    }
  } catch (e) {
    console.log("Error:", e?.message);
  }
}

main();
