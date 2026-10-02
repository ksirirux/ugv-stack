const VISION_API_URL = process.env.VISION_API_URL || "http://localhost:8001";

export const getVisionHealth = async (req, res) => {
  try {
    const response = await fetch(`${VISION_API_URL}/api/vision/health`);
    const body = await response.text();

    res
      .status(response.status)
      .type(response.headers.get("content-type") || "application/json")
      .send(body);
  } catch (error) {
    console.error("[VISION HEALTH ERROR]", error);
    res.status(502).json({
      error: "Vision service is unavailable",
      detail: error.message,
    });
  }
};

export const analyzeField = async (req, res) => {
  try {
    console.log("[VISION] Analyze field request");

    const response = await fetch(`${VISION_API_URL}/api/vision/analyze-field`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(req.body),
    });

    const body = await response.text();
    console.log("[VISION] Analyze field response:", body);

    res
      .status(response.status)
      .type(response.headers.get("content-type") || "application/json")
      .send(body);
  } catch (error) {
    console.error("[VISION ANALYZE ERROR]", error);
    res.status(502).json({
      error: "Vision service is unavailable",
      detail: error.message,
    });
  }
};
