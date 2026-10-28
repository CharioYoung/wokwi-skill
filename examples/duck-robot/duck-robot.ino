/*
 * 小鸭机器人 (Duck Robot) — Wokwi ESP32 仿真
 * ----------------------------------------------------------------
 * 功能：
 *   - 两只黄色 LED 眼睛，按周期闪烁
 *   - 两路舵机模拟鸭腿 / 翅膀摆动，向前"走路"
 *   - 无源蜂鸣器发出"嘎嘎"叫声（不同频率的两段短音）
 *   - HC-SR04 超声波检测前方障碍：距离 < 25cm 时，停下、大声嘎嘎、
 *     舵机反向摆动（后退转向）躲避，随后继续前进
 *
 * 接线（diagram.json 与之严格一致）：
 *   左眼 eyeL : GPIO2   右眼 eyeR : GPIO4   （各串 330Ω 到 GND）
 *   蜂鸣器    : GPIO13  （无源，+ 接 IO，- 接 GND）
 *   左腿 legL : GPIO14  右腿 legR : GPIO27 （舵机 SIG）
 *   超声波    : Trig GPIO5 / Echo GPIO18
 *   ESP32 TX -> $serialMonitor:RX（看打印）
 *
 * 库依赖：无。舵机用 ESP32 内置 LEDC 外设直接输出 50Hz PWM，
 *        不需要 ESP32Servo / Servo 等任何第三方库，粘贴即可编译。
 */

/* ---------------- 引脚定义 ---------------- */
#define EYE_L   2
#define EYE_R   4
#define BUZZER  13
#define SERVO_L 14
#define SERVO_R 27
#define TRIG    5
#define ECHO    18

/* ---------------- 行为参数 ---------------- */
const float OBSTACLE_CM = 25.0f;       // 障碍阈值（cm）
const unsigned long EYE_MS   = 800;    // 眼睛闪烁周期
const unsigned long QUACK_MS = 4000;   // 走路时自发"嘎嘎"间隔
const unsigned long BOOT_GRACE = 3000; // 上电前 3s 宽限：忽略障碍，先走路
const int AVOID_HITS = 2;              // 连续 N 次低于阈值才避障（消抖）
const int WALK_MIN = 60;               // 舵机摆动下界(度)
const int WALK_MAX = 120;              // 舵机摆动上界(度)

/* ---------------- 舵机驱动（原生 LEDC，零依赖） ---------------- */
const int SERVO_FREQ = 50;             // 舵机标准 50Hz
const int SERVO_RES  = 16;             // 16 位分辨率
const int CH_L = 0;                    // 左腿 PWM 通道（2.x 用通道号）
const int CH_R = 1;                    // 右腿 PWM 通道

void servoInit(int pin, int ch) {
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(pin, SERVO_FREQ, SERVO_RES);          // 3.x：按引脚绑定
#else
  ledcSetup(ch, SERVO_FREQ, SERVO_RES);            // 2.x：先配通道
  ledcAttachPin(pin, ch);
#endif
}

/* 角度 0..180 -> 脉宽 500..2500us -> 16 位占空比 */
void servoWrite(int pin, int ch, int angle) {
  if (angle < 0) angle = 0;
  if (angle > 180) angle = 180;
  int pulseUs = 500 + (angle * 2000) / 180;        // 500..2500us
  int duty = (int)((long)pulseUs * 65535L / 20000L); // 周期 20ms
#if defined(ESP_ARDUINO_VERSION_MAJOR) && ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(pin, duty);
#else
  (void)pin;
  ledcWrite(ch, duty);
#endif
}

unsigned long lastEye = 0, lastQuack = 0, phase = 0;
bool eyeOn = false;
int obstacleStreak = 0;

enum DuckState { WALK, AVOID };
DuckState state = WALK;

/* 嘎嘎叫：两段不同频率短音。loud 越大音调越高越"响" */
void quack(int times = 1, int loud = 0) {
  for (int i = 0; i < times; i++) {
    tone(BUZZER, 900 + loud);  delay(90);
    tone(BUZZER, 600 + loud);  delay(110);
    noTone(BUZZER);
    delay(120);
  }
}

/* 读 HC-SR04 距离（cm）。失败返回 -1 */
float readDistance() {
  digitalWrite(TRIG, LOW);  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH); delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long us = pulseIn(ECHO, HIGH, 30000);
  if (us == 0) return -1.0f;
  return us / 58.0f;
}

/* 走路：左右舵机相位差摆动，产生前进的摆动感 */
void walkWaddle() {
  phase += 12; if (phase > 180) phase -= 180;
  int aL = WALK_MIN + (int)((WALK_MAX - WALK_MIN) * (0.5 - 0.5 * cos(phase * PI / 180.0)));
  int aR = WALK_MIN + (int)((WALK_MAX - WALK_MIN) * (0.5 - 0.5 * cos((phase + 120) * PI / 180.0)));
  servoWrite(SERVO_L, CH_L, aL); servoWrite(SERVO_R, CH_R, aR);
}

/* 躲避：左右舵机反相摆动，模拟后退 / 转向 */
void avoidWaddle() {
  phase += 12; if (phase > 180) phase -= 180;
  int aL = WALK_MIN + (int)((WALK_MAX - WALK_MIN) * (0.5 - 0.5 * cos(phase * PI / 180.0)));
  int aR = WALK_MIN + (int)((WALK_MAX - WALK_MIN) * (0.5 - 0.5 * cos((phase + 180) * PI / 180.0)));
  servoWrite(SERVO_L, CH_L, aL); servoWrite(SERVO_R, CH_R, aR);
}

void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(EYE_L, OUTPUT);  pinMode(EYE_R, OUTPUT);
  pinMode(TRIG, OUTPUT);   pinMode(ECHO, INPUT);
  pinMode(BUZZER, OUTPUT); noTone(BUZZER);

  servoInit(SERVO_L, CH_L); servoInit(SERVO_R, CH_R);
  servoWrite(SERVO_L, CH_L, 90); servoWrite(SERVO_R, CH_R, 90);   // 中位

  Serial.println();
  Serial.println("=========================================");
  Serial.println("  小鸭机器人 Duck Robot  (ESP32 @ Wokwi)");
  Serial.println("  walk  <-->  avoid  on HC-SR04 obstacle");
  Serial.println("=========================================");

  /* 上电自检 */
  Serial.println("[BOOT] self-test ...");
  digitalWrite(EYE_L, HIGH); digitalWrite(EYE_R, HIGH); delay(300);
  digitalWrite(EYE_L, LOW);  digitalWrite(EYE_R, LOW);  delay(300);
  quack(2, 200);   // 打招呼的"嘎嘎"
  Serial.println("[BOOT] self-test done");
  Serial.println("[WALK] started - waddling around");

  lastEye = millis();
  lastQuack = millis();
}

void loop() {
  unsigned long now = millis();

  /* 眼睛闪烁 */
  if (now - lastEye >= EYE_MS) {
    lastEye = now; eyeOn = !eyeOn;
    digitalWrite(EYE_L, eyeOn ? HIGH : LOW);
    digitalWrite(EYE_R, eyeOn ? HIGH : LOW);
  }

  float d = readDistance();

  // 消抖：连续 AVOID_HITS 次低于阈值才认定有障碍（避免单次误读）
  bool hit = (d >= 0 && d < OBSTACLE_CM);
  if (hit) obstacleStreak++; else obstacleStreak = 0;
  bool shouldAvoid = (obstacleStreak >= AVOID_HITS) && (now >= BOOT_GRACE);

  if (shouldAvoid) {
    if (state != AVOID) {
      state = AVOID;
      Serial.print("[AVOID] obstacle @ "); Serial.print(d, 1);
      Serial.println(" cm -> QUACK + turn");
      quack(3, 400);     // 大声嘎嘎报警
    }
    avoidWaddle();
  } else {
    if (state != WALK) {
      state = WALK;
      Serial.print("[WALK] path clear (dist=");
      if (d < 0) Serial.print("?"); else Serial.print(d, 1);
      Serial.println(" cm) -> resume");
      lastQuack = now;
    }
    walkWaddle();
    if (now - lastQuack >= QUACK_MS) {
      lastQuack = now;
      quack(1, 0);
      Serial.println("[QUACK] *嘎*");
    }
  }

  delay(120);
}
