import { useId, type ReactNode } from "react";

/* Сцены учебной камеры фотоконтроля. На компьютере нет задней камеры, поэтому «видоискатель»
   показывает нарисованный двор, машину, салон и документы. Рамка-подсказка поверх сцены
   совпадает с её контуром: когда картинка встаёт на место, кадр считается ровным.
   Документы помечены как учебный образец и не повторяют настоящих бланков. */

export type PhotoKind = "front" | "left" | "rear" | "right" | "seats-front" | "seats-rear" | "trunk" | "doc-front" | "doc-back";

export interface PhotoArtData { plate: string; car: string; year?: number }

/** 280XSH03 → «280 XSH» и регион «03», как на казахстанском номере. */
export function plateParts(plate: string) {
  const clean = plate.toUpperCase().replace(/\s+/g, "");
  const match = clean.match(/^(\d{3})([A-Z]{2,3})(\d{2})$/);
  return match ? { main: `${match[1]} ${match[2]}`, region: match[3] } : { main: clean.slice(0, 9), region: "" };
}

function Plate({ x, y, w, plate }: { x: number; y: number; w: number; plate: string }) {
  const h = w * 0.22, { main, region } = plateParts(plate), split = region ? w * 0.8 : w;
  return <g transform={`translate(${x} ${y})`}>
    <rect width={w} height={h} rx={h * 0.14} fill="#fbfbf7" stroke="#1b1d20" strokeWidth={h * 0.07} />
    <rect x={h * 0.1} y={h * 0.12} width={w * 0.12} height={h * 0.76} rx={h * 0.08} fill="#27a2d8" />
    <text x={h * 0.1 + w * 0.06} y={h * 0.7} fontSize={h * 0.34} fill="#fff" textAnchor="middle" fontWeight="800">KZ</text>
    <text x={(w * 0.14 + split) / 2} y={h * 0.76} fontSize={h * 0.64} fontWeight="800" textAnchor="middle" fill="#15171a" fontFamily="ui-monospace,'Roboto Mono',monospace">{main}</text>
    {region && <><path d={`M${split} ${h * 0.12}V${h * 0.88}`} stroke="#1b1d20" strokeWidth={h * 0.06} />
      <text x={(split + w) / 2} y={h * 0.76} fontSize={h * 0.62} fontWeight="800" textAnchor="middle" fill="#15171a" fontFamily="ui-monospace,'Roboto Mono',monospace">{region}</text></>}
  </g>;
}

/** Двор с парковкой: день, ровный свет — как советуют снимать. */
function Yard({ id }: { id: string }) {
  return <>
    <defs>
      <linearGradient id={`${id}sky`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#6f9ccc" /><stop offset="1" stopColor="#d7e3ee" /></linearGradient>
      <linearGradient id={`${id}road`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7b8087" /><stop offset="1" stopColor="#40444a" /></linearGradient>
    </defs>
    <rect width="300" height="400" fill={`url(#${id}sky)`} />
    <g fill="#ffffff" opacity=".55"><ellipse cx="62" cy="62" rx="34" ry="9" /><ellipse cx="84" cy="54" rx="22" ry="10" /><ellipse cx="226" cy="92" rx="30" ry="7" /></g>
    <path d="M0 236V150h34v-22h30v108zM70 236V118h44v118zM120 236V160h26v-26h40v102zM192 236V128h48v108zM246 236V150h54v86z" fill="#a9b6c5" />
    <g fill="#c7d2de">{[[80, 132], [96, 132], [80, 152], [96, 152], [80, 172], [96, 172], [202, 142], [220, 142], [202, 164], [220, 164], [202, 186], [220, 186], [256, 164], [276, 164], [256, 186], [276, 186]].map(([x, y]) => <rect key={`${x}-${y}`} x={x} y={y} width="10" height="12" rx="1.5" />)}</g>
    <g fill="#5d8a64"><circle cx="18" cy="222" r="20" /><circle cx="44" cy="228" r="15" /><circle cx="262" cy="222" r="18" /><circle cx="286" cy="226" r="16" /></g>
    <rect y="232" width="300" height="168" fill={`url(#${id}road)`} />
    <path d="M0 240H300" stroke="#9aa0a8" strokeWidth="4" />
    <g stroke="#e9ebee" strokeWidth="3" opacity=".7"><path d="M-20 400 40 250" /><path d="M320 400 260 250" /><path d="M150 400V372" /></g>
  </>;
}

function Wheel({ cx, cy, r = 24 }: { cx: number; cy: number; r?: number }) {
  return <g><circle cx={cx} cy={cy} r={r} fill="#16181b" /><circle cx={cx} cy={cy} r={r * 0.6} fill="#b8bec6" /><circle cx={cx} cy={cy} r={r * 0.44} fill="#8d949d" />
    <g stroke="#c9ced5" strokeWidth={r * 0.1}>{[0, 72, 144, 216, 288].map(a => <path key={a} d={`M${cx} ${cy}l${Math.cos(a * Math.PI / 180) * r * 0.44} ${Math.sin(a * Math.PI / 180) * r * 0.44}`} />)}</g>
    <circle cx={cx} cy={cy} r={r * 0.14} fill="#e3e6ea" /></g>;
}

const BODY = "#eceef1", SHADE = "#c6cbd2", DARK = "#23272d", GLASS = "#34465a";

// Контур спереди и сзади общий: рамка подсказки рисуется по нему же.
const FRONT_OUTLINE = "M44 318 42 272Q44 244 70 234L86 226 104 182Q150 172 196 182L214 226 230 234Q256 244 258 272L256 318Q255 326 246 326H54Q45 326 44 318Z";
const TRUNK_OUTLINE = "M44 318 42 272Q44 244 70 234L88 230 92 142 104 122Q150 112 196 122L208 142 212 230 230 234Q256 244 258 272L256 318Q255 326 246 326H54Q45 326 44 318Z";
const SIDE_OUTLINE = "M24 300Q22 282 36 276L72 266Q86 262 98 250L130 222Q142 212 158 212H214Q230 212 240 224L264 254Q280 258 282 274L284 300Q284 310 274 310H30Q24 310 24 300Z";

function CarFront({ plate }: { plate: string }) {
  return <g>
    <ellipse cx="150" cy="330" rx="130" ry="10" fill="#000" opacity=".35" />
    <rect x="46" y="296" width="34" height="38" rx="7" fill="#16181b" /><rect x="220" y="296" width="34" height="38" rx="7" fill="#16181b" />
    <path d="M60 228 42 226Q35 226 35 232V238Q35 243 41 243L62 239Z" fill={BODY} /><path d="M240 228 258 226Q265 226 265 232V238Q265 243 259 243L238 239Z" fill={BODY} />
    <path d={FRONT_OUTLINE} fill={BODY} />
    <path d="M94 224 109 188Q150 180 191 188L206 224Z" fill={GLASS} />
    <path d="M114 191 128 189 108 222H98Z" fill="#fff" opacity=".2" /><path d="M134 188 142 187 124 222H118Z" fill="#fff" opacity=".12" />
    <path d="M86 226H214L232 242H68Z" fill={SHADE} opacity=".55" />
    <path d="M54 258Q56 248 70 247L108 250 104 266 60 270Q53 270 54 258Z" fill="#2a3038" /><path d="M61 256 100 254 98 262 63 265Z" fill="#f4f8ff" />
    <path d="M246 258Q244 248 230 247L192 250 196 266 240 270Q247 270 246 258Z" fill="#2a3038" /><path d="M239 256 200 254 202 262 237 265Z" fill="#f4f8ff" />
    <path d="M112 252H188L184 280Q150 286 116 280Z" fill={DARK} />
    <g stroke="#3c434c" strokeWidth="2"><path d="M116 260H184M117 268H183M119 276H181" /></g>
    <circle cx="150" cy="264" r="5" fill="#d3d8de" />
    <path d="M86 290H214L207 314H93Z" fill="#2a2e34" />
    <circle cx="72" cy="302" r="5" fill="#e8edf3" /><circle cx="228" cy="302" r="5" fill="#e8edf3" />
    <Plate x={113} y={292} w={74} plate={plate} />
  </g>;
}

function CarRear({ plate }: { plate: string }) {
  return <g>
    <ellipse cx="150" cy="330" rx="130" ry="10" fill="#000" opacity=".35" />
    <rect x="46" y="296" width="34" height="38" rx="7" fill="#16181b" /><rect x="220" y="296" width="34" height="38" rx="7" fill="#16181b" />
    <path d="M60 228 42 226Q35 226 35 232V238Q35 243 41 243L62 239Z" fill={BODY} /><path d="M240 228 258 226Q265 226 265 232V238Q265 243 259 243L238 239Z" fill={BODY} />
    <path d={FRONT_OUTLINE} fill={BODY} />
    <path d="M100 222 112 190Q150 183 188 190L200 222Z" fill={GLASS} /><path d="M116 194 128 192 112 220H104Z" fill="#fff" opacity=".18" />
    <path d="M152 186h-4v-9h4z" fill={DARK} />
    <path d="M78 232H222L236 250H64Z" fill={SHADE} opacity=".5" />
    <path d="M50 252Q52 244 64 244L104 248 100 266 58 266Q50 264 50 252Z" fill="#b3201f" /><path d="M58 252 96 252 95 259 60 259Z" fill="#ff6a5c" />
    <path d="M250 252Q248 244 236 244L196 248 200 266 242 266Q250 264 250 252Z" fill="#b3201f" /><path d="M242 252 204 252 205 259 240 259Z" fill="#ff6a5c" />
    <path d="M104 250H196" stroke={SHADE} strokeWidth="2" />
    <rect x="110" y="256" width="80" height="26" rx="5" fill="#dfe3e8" />
    <Plate x={113} y={262} w={74} plate={plate} />
    <path d="M60 298H240L234 316H66Z" fill="#2a2e34" />
    <rect x="62" y="300" width="18" height="4" rx="2" fill="#d93a33" /><rect x="220" y="300" width="18" height="4" rx="2" fill="#d93a33" />
    <rect x="198" y="316" width="16" height="6" rx="3" fill="#5a6068" />
  </g>;
}

function CarSide() {
  return <g>
    <ellipse cx="152" cy="330" rx="140" ry="9" fill="#000" opacity=".35" />
    <path d="M100 252 90 246Q85 245 84 250V255L100 258Z" fill={BODY} />
    <path d={SIDE_OUTLINE} fill={BODY} />
    <path d="M106 254 136 226Q143 220 152 220H176V254Z" fill={GLASS} />
    <path d="M182 220H212Q224 220 232 230L252 254H182Z" fill={GLASS} />
    <path d="M118 250 142 228H150L126 250Z" fill="#fff" opacity=".18" />
    <path d="M100 256V304M178 256V306M254 258 256 300" stroke={SHADE} strokeWidth="2" fill="none" />
    <rect x="150" y="266" width="15" height="4" rx="2" fill={SHADE} /><rect x="226" y="266" width="15" height="4" rx="2" fill={SHADE} />
    <path d="M28 282Q32 272 46 270L62 268 58 282Z" fill="#f4f8ff" /><path d="M270 262 282 266 283 280 272 278Z" fill="#c9302c" />
    <path d="M100 284H258" stroke="#ffcf1f" strokeWidth="6" />
    <g fill="#1d1f22">{Array.from({ length: 13 }, (_, i) => <rect key={i} x={104 + i * 12} y={i % 2 ? 281 : 284} width="6" height="3" />)}</g>
    <path d="M46 310Q48 278 78 278Q108 278 110 310Z" fill="#101214" /><path d="M198 310Q200 278 230 278Q260 278 262 310Z" fill="#101214" />
    <Wheel cx={78} cy={306} /><Wheel cx={230} cy={306} />
  </g>;
}

function CarTrunk({ plate }: { plate: string }) {
  return <g>
    <ellipse cx="150" cy="330" rx="130" ry="10" fill="#000" opacity=".35" />
    <rect x="46" y="296" width="34" height="38" rx="7" fill="#16181b" /><rect x="220" y="296" width="34" height="38" rx="7" fill="#16181b" />
    <path d="M60 228 42 226Q35 226 35 232V238Q35 243 41 243L62 239Z" fill={BODY} /><path d="M240 228 258 226Q265 226 265 232V238Q265 243 259 243L238 239Z" fill={BODY} />
    <path d={FRONT_OUTLINE} fill={BODY} />
    <path d="M100 222 112 190Q150 183 188 190L200 222Z" fill={GLASS} />
    <path d="M70 236H230L240 286H60Z" fill="#131518" />
    <path d="M78 244H222L228 280H72Z" fill="#23262b" />
    <rect x="84" y="250" width="54" height="30" rx="5" fill="#5d4a3a" /><path d="M94 250v-6h34v6" stroke="#3e3128" strokeWidth="3" fill="none" />
    <path d="M92 142 104 122Q150 112 196 122L208 142 212 230H88Z" fill={BODY} /><path d="M100 146 108 130Q150 122 192 130L200 146Z" fill={SHADE} opacity=".6" />
    <path d="M96 214Q150 206 204 214" stroke={SHADE} strokeWidth="3" fill="none" />
    <path d="M50 252Q52 244 64 244L68 246 64 266 58 266Q50 264 50 252Z" fill="#b3201f" /><path d="M250 252Q248 244 236 244L232 246 236 266 242 266Q250 264 250 252Z" fill="#b3201f" />
    <path d="M60 286H240L234 316H66Z" fill="#2a2e34" />
    <Plate x={113} y={294} w={74} plate={plate} />
  </g>;
}

function SeatsFront({ id }: { id: string }) {
  return <>
    <defs><linearGradient id={`${id}out`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8fb3d6" /><stop offset="1" stopColor="#dfe8ef" /></linearGradient></defs>
    <rect width="300" height="400" fill="#2a2c30" />
    <path d="M28 70Q150 44 272 70L292 200H8Z" fill={`url(#${id}out)`} />
    <path d="M40 200V150h30v-20h28v70zM200 200V140h40v60zM246 200v-44h40v44z" fill="#b1bdca" />
    <path d="M0 0H300V78Q150 50 0 78Z" fill="#3b3e44" /><path d="M8 200 28 70 0 60V220ZM292 200 272 70 300 60V220Z" fill="#303338" />
    <rect x="128" y="66" width="44" height="14" rx="6" fill="#1b1d20" />
    <path d="M0 196Q150 176 300 196V250H0Z" fill="#1c1e21" />
    <rect x="124" y="204" width="52" height="30" rx="5" fill="#0d1a28" /><path d="M130 226 142 214 152 220 168 208" stroke="#57a7ff" strokeWidth="2" fill="none" />
    <g fill="#2b2f35"><rect x="96" y="206" width="20" height="8" rx="3" /><rect x="184" y="206" width="20" height="8" rx="3" /></g>
    <circle cx="86" cy="246" r="40" fill="none" stroke="#131416" strokeWidth="10" /><path d="M50 250H122M86 246V284" stroke="#131416" strokeWidth="9" /><circle cx="86" cy="248" r="10" fill="#26292e" />
    <rect x="52" y="206" width="54" height="42" rx="16" fill="#383c43" /><rect x="194" y="206" width="54" height="42" rx="16" fill="#383c43" />
    <path d="M24 262Q24 240 48 238H110Q134 240 134 262V400H24Z" fill="#3f444b" /><path d="M166 262Q166 240 190 238H252Q276 240 276 262V400H166Z" fill="#3f444b" />
    <path d="M48 264V400M110 264V400M190 264V400M252 264V400" stroke="#4d535b" strokeWidth="2" strokeDasharray="4 4" />
    <path d="M30 250 124 368M270 250 176 368" stroke="#17191c" strokeWidth="7" strokeLinecap="round" /><rect x="118" y="352" width="14" height="22" rx="3" fill="#8a9099" /><rect x="168" y="352" width="14" height="22" rx="3" fill="#8a9099" />
    <path d="M134 300H166V400H134Z" fill="#26292e" /><rect x="140" y="312" width="20" height="30" rx="8" fill="#32363c" />
  </>;
}

function SeatsRear({ id }: { id: string }) {
  return <>
    <defs><linearGradient id={`${id}rear`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#95b5d4" /><stop offset="1" stopColor="#dbe5ee" /></linearGradient></defs>
    <rect width="300" height="400" fill="#2b2d31" />
    <path d="M52 40Q150 26 248 40L262 120H38Z" fill={`url(#${id}rear)`} />
    <path d="M60 120V88h24v32zM200 120V80h30v40z" fill="#b3bfcc" />
    <path d="M0 0H300V44Q150 22 0 44Z" fill="#3a3d43" />
    <path d="M30 120H270L282 140H18Z" fill="#1d1f22" />
    <g fill="#474c54"><rect x="52" y="112" width="52" height="34" rx="14" /><rect x="124" y="112" width="52" height="34" rx="14" /><rect x="196" y="112" width="52" height="34" rx="14" /></g>
    <path d="M20 170Q22 142 52 140H248Q278 142 280 170L284 300H16Z" fill="#454a52" />
    <path d="M110 150V296M190 150V296" stroke="#353a40" strokeWidth="3" />
    <path d="M40 180V290M260 180V290" stroke="#51575f" strokeWidth="2" strokeDasharray="4 4" />
    <path d="M60 146 96 290M240 146 204 290M150 150V250" stroke="#191b1e" strokeWidth="6" strokeLinecap="round" />
    <g fill="#8a9099"><rect x="98" y="286" width="12" height="18" rx="3" /><rect x="190" y="286" width="12" height="18" rx="3" /><rect x="144" y="286" width="12" height="18" rx="3" /></g>
    <path d="M8 300Q10 286 30 284H270Q290 286 292 300L296 350H4Z" fill="#50565e" />
    <path d="M4 350H296V400H4Z" fill="#1a1c1f" />
    <path d="M0 0 20 0 16 400H0ZM300 0 280 0 284 400H300Z" fill="#222428" />
  </>;
}

function Desk() {
  return <>
    <rect width="300" height="400" fill="#7a5d44" />
    <g stroke="#6a4f39" strokeWidth="3" opacity=".7" fill="none">{[40, 96, 150, 214, 300, 356].map((y, i) => <path key={y} d={`M-10 ${y}Q80 ${y + (i % 2 ? 14 : -12)} 160 ${y}T310 ${y}`} />)}</g>
  </>;
}

/** Карточка документа на столе. Надпись «Учебный образец» всегда видна. */
function Card({ children, tone = "#eef3ef", title }: { children: ReactNode; tone?: string; title: string }) {
  return <g>
    <rect x="34" y="124" width="236" height="152" rx="10" fill="#000" opacity=".3" transform="translate(3 5)" />
    <rect x="30" y="120" width="240" height="152" rx="10" fill={tone} />
    <g stroke="#b9c9c0" strokeWidth=".8" fill="none" opacity=".8">{[0, 1, 2, 3, 4, 5].map(i => <path key={i} d={`M30 ${150 + i * 20}Q90 ${136 + i * 20} 150 ${150 + i * 20}T270 ${150 + i * 20}`} />)}</g>
    <rect x="30" y="120" width="240" height="24" rx="10" fill="#2f6f8f" /><rect x="30" y="134" width="240" height="10" fill="#2f6f8f" />
    <text x="150" y="136" fontSize="9.5" fontWeight="700" fill="#fff" textAnchor="middle" letterSpacing=".4">{title}</text>
    {children}
    <text x="150" y="222" fontSize="19" fontWeight="800" fill="#c2413a" opacity=".32" textAnchor="middle" transform="rotate(-14 150 214)" letterSpacing="2">УЧЕБНЫЙ ОБРАЗЕЦ</text>
  </g>;
}
function Field({ y, label, value, x = 44, w = 212 }: { y: number; label: string; value?: string; x?: number; w?: number }) {
  return <g><text x={x} y={y} fontSize="6.5" fill="#6a7872">{label}</text>
    {value ? <text x={x} y={y + 11} fontSize="10" fontWeight="700" fill="#1f2a26" fontFamily="ui-monospace,'Roboto Mono',monospace">{value}</text> : <rect x={x} y={y + 4} width={w * 0.6} height="7" rx="2" fill="#c8d3cd" />}
    <path d={`M${x} ${y + 15}H${x + w}`} stroke="#c3cfc9" strokeWidth=".8" /></g>;
}

function DocFront({ data }: { data: PhotoArtData }) {
  return <><Desk /><Card title="СВИДЕТЕЛЬСТВО О РЕГИСТРАЦИИ ТС">
    <Field y={158} label="Регистрационный номер" value={plateParts(data.plate).main + (plateParts(data.plate).region ? ` ${plateParts(data.plate).region}` : "")} w={120} />
    <Field y={158} x={180} label="Год выпуска" value={data.year ? String(data.year) : "—"} w={76} />
    <Field y={186} label="Марка, модель" value={data.car.toUpperCase().slice(0, 24)} />
    <Field y={214} label="Владелец" />
    <Field y={242} label="Категория ТС" value="B" w={80} />
  </Card></>;
}
function DocBack() {
  return <><Desk /><Card title="ОБОРОТНАЯ СТОРОНА">
    <Field y={158} label="VIN" value="XXXXXXXXXXXXXXXXX" />
    <Field y={186} label="Цвет" w={100} /><Field y={186} x={160} label="Объём двигателя" w={96} />
    <Field y={214} label="Особые отметки" />
    <Field y={242} label="Выдано" w={120} /><Field y={242} x={180} label="Дата" w={76} />
  </Card></>;
}
/** Сама сцена. В видоискателе её оборачивает дрожащая группа, в миниатюрах — нет. */
export function PhotoScene({ kind, data }: { kind: PhotoKind; data: PhotoArtData }) {
  const id = useId().replace(/[^a-zA-Z0-9]/g, "");
  if (kind === "seats-front") return <SeatsFront id={id} />;
  if (kind === "seats-rear") return <SeatsRear id={id} />;
  if (kind === "doc-front") return <DocFront data={data} />;
  if (kind === "doc-back") return <DocBack />;
  return <><Yard id={id} />
    {kind === "front" ? <CarFront plate={data.plate} /> : kind === "rear" ? <CarRear plate={data.plate} /> : kind === "trunk" ? <CarTrunk plate={data.plate} /> : kind === "left" ? <CarSide /> : <g transform="translate(300 0) scale(-1 1)"><CarSide /></g>}
  </>;
}

/** Рамка-подсказка поверх видоискателя: где должен оказаться объект съёмки. */
export function PhotoGuide({ kind }: { kind: PhotoKind }) {
  if (kind === "front" || kind === "rear") return <path d={FRONT_OUTLINE} />;
  if (kind === "trunk") return <path d={TRUNK_OUTLINE} />;
  if (kind === "left") return <path d={SIDE_OUTLINE} />;
  if (kind === "right") return <path d={SIDE_OUTLINE} transform="translate(300 0) scale(-1 1)" />;
  if (kind === "seats-front" || kind === "seats-rear") return <rect x="16" y={kind === "seats-front" ? 60 : 30} width="268" height={kind === "seats-front" ? 320 : 330} rx="18" />;
  return <rect x="30" y="120" width="240" height="152" rx="10" />;
}

// Миниатюры плиток — альбомные, как в приложении. Окно выбрано так, чтобы объект был целиком.
const THUMB: Record<PhotoKind, string> = {
  front: "0 142 300 225", rear: "0 142 300 225", left: "0 150 300 225", right: "0 150 300 225", trunk: "0 110 300 225",
  "seats-front": "0 140 300 225", "seats-rear": "0 80 300 225", "doc-front": "0 84 300 225", "doc-back": "0 84 300 225",
};

/** Статичный снимок: плитки, превью после съёмки и пример кадра. */
export function PhotoThumb({ kind, data, className = "", wide = false }: { kind: PhotoKind; data: PhotoArtData; className?: string; wide?: boolean }) {
  return <svg className={className} viewBox={wide ? THUMB[kind] : "0 0 300 400"} preserveAspectRatio="xMidYMid slice" aria-hidden="true"><PhotoScene kind={kind} data={data} /></svg>;
}
