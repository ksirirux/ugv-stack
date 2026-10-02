import mqtt from "mqtt";
import dotenv from "dotenv";

dotenv.config();

// const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL || "mqtt://192.168.1.129:1883";
// const MQTT_USERNAME = process.env.MQTT_USERNAME || "plookpak";
// const MQTT_PASSWORD = process.env.MQTT_PASSWORD || "EJ90317A4";

// const mqttOptions = {
//   username: MQTT_USERNAME,
//   password: MQTT_PASSWORD
// };

// const mqttClient = mqtt.connect(MQTT_BROKER_URL, mqttOptions);

// mqttClient.on('connect', () => {
//   console.log('[MQTT] Connected to Broker:', MQTT_BROKER_URL);
// });

// mqttClient.on('error', (err) => {
//   console.error('[MQTT] Connection error:', err);
// });

//export default mqttClient;
