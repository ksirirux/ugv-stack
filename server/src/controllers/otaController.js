const PORT = 8080;

export const uploadFirmware = (req, res) => {
  const hostIp = req.hostname;
  const downloadUrl = `http://${hostIp}:${PORT}/firmware/update.bin`;
  return res.json({ success: true, message: "OTA Update triggered", url: downloadUrl });
};
