/**
 * 独立跑一遍 Electron 的显卡信息，确认 gpuDevice / glRenderer 里到底有什么字段。
 * 用法: npx electron tools/gpu-info.cjs
 */
const { app } = require('electron');
app.whenReady().then(async () => {
  const basic = await app.getGPUInfo('basic');
  const full = await app.getGPUInfo('complete');
  console.log('basic.gpuDevice =', JSON.stringify(basic.gpuDevice));
  console.log('full.gpuDevice  =', JSON.stringify(full.gpuDevice));
  console.log('glRenderer =', full.auxAttributes && full.auxAttributes.glRenderer);
  console.log('glVendor   =', full.auxAttributes && full.auxAttributes.glVendor);
  console.log('machineModelName =', full.machineModelName);
  app.quit();
});
