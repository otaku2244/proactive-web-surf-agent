import { SurfApp } from "./app.js";
import { loadConfig } from "./config.js";

async function main(): Promise<void> {
  const config = await loadConfig();
  const app = new SurfApp(config);
  await app.start();

  // --once：跑一趟就退出。积温桥 spawn 本进程时走这条路径。
  if (process.argv.includes("--once")) {
    await app.run(true);
    return;
  }

  console.log(
    `Proactive Web Surf Agent v2 (${config.provider} -> ${config.deliveryChannel}).`
  );

  // AUTO_SCHEDULE=false：不自主排期，只等桥 spawn。
  // 挂到积温后必须这么设 —— 自主排期会绕过静默时段和日上限两道闸。
  if (!config.autoSchedule) {
    console.log("自主排期已关闭（AUTO_SCHEDULE=false），本进程只做单次执行。");
    return;
  }

  setInterval(() => void app.run().catch((error) => {
    console.error(`Surf deferred: ${error instanceof Error ? error.message : String(error)}`);
  }), 60_000);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});