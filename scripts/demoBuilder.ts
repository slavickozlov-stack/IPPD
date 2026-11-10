// Построение синтетических документов для демонстрации и тестов. Все данные вымышлены.
import { AlignmentType, Document, Footer, Header, Packer, Paragraph, Table, TableCell, TableRow, TextRun, WidthType } from 'docx'
import JSZip from 'jszip'

export const SYNTH = 'СИНТЕТИЧЕСКИЙ ДОКУМЕНТ ДЛЯ ДЕМОНСТРАЦИИ. Не является документом предприятия.'

const p = (text: string, opts: { bold?: boolean; center?: boolean } = {}) =>
  new Paragraph({
    alignment: opts.center ? AlignmentType.CENTER : undefined,
    children: text.split('\n').map((line, i) => new TextRun({ text: line, bold: opts.bold, break: i ? 1 : undefined }))
  })

/** Ячейка: строка или [текст, число объединяемых столбцов]. Перенос \n — отдельный абзац в ячейке. */
type Cell = string | [string, number]

function table(rows: Cell[][]): Table {
  return new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: rows.map(
      (r) =>
        new TableRow({
          children: r.map((c) => {
            const [text, span] = typeof c === 'string' ? [c, 1] : c
            return new TableCell({ columnSpan: span > 1 ? span : undefined, children: (text || ' ').split('\n').map((t) => p(t)) })
          })
        })
    )
  })
}

export type Block = { p: string; bold?: boolean; center?: boolean } | { t: Cell[][] }

export async function buildDocx(blocks: Block[], footer?: string, header?: string): Promise<Buffer> {
  const doc = new Document({
    creator: 'ИППД Контроль — генератор синтетических данных',
    lastModifiedBy: 'ИППД Контроль',
    sections: [
      {
        footers: footer ? { default: new Footer({ children: [p(footer)] }) } : undefined,
        headers: header ? { default: new Header({ children: [p(header)] }) } : undefined,
        children: blocks.map((b) => ('t' in b ? table(b.t) : p(b.p, b)))
      }
    ]
  })
  return Packer.toBuffer(doc)
}

// ——— ИППД ———

export interface IppdOptions {
  /** Убрать таблицу теоретической подготовки (для теста неполного разбора). */
  dropTheory?: boolean
  /** Сломать строку темы объединением ячеек (для теста нераспознанной строки). */
  breakRow?: boolean
}

const THEORY_HEADER = ['Номер курса, раздела, темы', 'Наименование курса, раздела, темы', 'Форма обучения', 'Место обучения', 'Продолжительность обучения (часы)', 'Учебные материалы', 'Должность, фамилия, инициалы ответственного за обучение', 'Отметка о проведенном обучении']

export function demoIppdBlocks(o: IppdOptions = {}): Block[] {
  const R = 'Инструктор ДЕМО-1'
  const theory: Cell[][] = [
    THEORY_HEADER,
    ['1', ['Охрана труда (синтетический курс)', 1], ['10', 1], ['', 3]],
    ['1.1', 'Средства коллективной и индивидуальной защиты', 'Сп', 'УТП', '2', 'I.К1.Т13.УМСИ.ДЕМО.0101.2024 [1]', R, ''],
    ['1.3', 'Порядок допуска к работам (пропущен номер 1.2)', 'Сп', 'УТП', '2', 'I.К1.Т20.УМСИ.ДЕМО.0103.2022 [2]', R, ''],
    ['1.4', 'Первичные средства пожаротушения', 'А', 'УТП', '2', 'I.К5.Т5.ПАЗ.ДЕМО.0102.2021 [3]', R, ''],
    ['1.5', 'Правила по охране труда (первоисточник)', 'Конс', 'УТП', '1', 'ИОТ.99.01 изм.3', R, ''],
    ['1.6', 'Тема без указания учебных материалов', 'Сп', 'УТП', '1', '', R, ''],
    ['2', ['Культура безопасности (синтетический курс)', 1], ['8', 1], ['', 3]],
    ['2.1', 'Основы культуры безопасности', 'Сп', 'УТП', '4', 'II.К6.Т11.УМСИ.ДЕМО.0104.2021 [4]', R, ''],
    ['2.2', 'Конструкция оборудования: занятие', 'Сп', 'УТП', '2', 'III.К18.Т1.ПАЗ.ДЕМО.0105.2023 [5]', R, ''],
    ['2.3', 'Радиационная безопасность (материал не загружен)', 'Сп', 'УТП', '2', 'I.К4.Т3.УМСИ.ДЕМО.0109.2022 [6]', R, ''],
    ['2.4', 'Обозначение с латинской буквой K', 'Сп', 'УТП', '1', 'I.K1.Т13.УМСИ.ДЕМО.0101.2024 [1]', R, ''],
    ['2.5', 'Нормативные требования к оборудованию', 'Сп', 'УТП', '2', 'I.К2.Т4.УМСИ.ДЕМО.0106.2024 [7]', R, ''],
    ['2.6', 'Командная работа (УММ отменён по реестру)', 'Сп', 'УТП', '1', 'II.К7.Т3.УМСИ.ДЕМО.0108.2024 [9]', R, ''],
    ['2.7', 'Пожарная безопасность (выпущен новый УММ)', 'Сп', 'УТП', '1', 'I.К5.Т36.УМСИ.ДЕМО.0110.2023 «Пожарная безопасность»', R, '']
  ]
  if (o.breakRow) theory[3] = ['1.3', ['Порядок допуска к работам — ячейки объединены', 4], 'I.К1.Т20.УМСИ.ДЕМО.0103.2022 [2]', R, '']
  return [
    { p: SYNTH, bold: true },
    { t: [['Акционерное общество «Демонстрационный концерн» (синтетика)\nФилиал «Демонстрационная атомная станция»']] },
    { t: [['', 'УТВЕРЖДАЮ'], ['', 'Начальник демонстрационного цеха'], ['', '(подпись)'], ['', '«_____»_______________2026 г.']] },
    { p: 'Индивидуальная программа подготовки', center: true, bold: true },
    { p: 'Работника ДЕМО-001 (синтетика)', center: true },
    { p: 'на должность инженера демонстрационного участка', center: true },
    { p: 'демонстрационного цеха', center: true },
    { p: 'филиала «Демонстрационная атомная станция»', center: true },
    { p: 'ИППД.99.ДЕМО.001', center: true },
    { p: 'Лист согласования' },
    { p: 'Приложить полный лист визирования из ЕОСДО (синтетика)' },
    { p: 'Содержание' },
    { t: [['1', 'Общие положения', '3'], ['2', 'План-график подготовки', '4'], ['3', 'Тематический план индивидуальной программы подготовки', '5'], ['4', 'Оценка обучения', '8']] },
    { p: '1 Общие положения' },
    { p: '1.1 Цель подготовки' },
    { p: 'Целью подготовки является получение работником ДЕМО-001 знаний, умений, навыков, необходимых для выполнения обязанностей по должности инженера демонстрационного участка.' },
    { p: '1.2 Продолжительность обучения' },
    { p: 'Продолжительность обучения по настоящей программе составляет 40 часов.' },
    { p: '2 План-график подготовки' },
    {
      t: [
        ['№ п/п', 'Наименование мероприятия', 'Место проведения', 'Календарные сроки', 'Должность, фамилия, инициалы ответственного'],
        ['1', 'Теоретическая подготовка', 'УТП', 'с 01.09.2026 по 30.09.2026', 'Инструктор ДЕМО-1'],
        ['2', ['Стажировка:', 4]],
        ['2.1', 'Стажировка по охране труда на рабочем месте', 'Цех ДЕМО', 'с 1.10.2026 по 14.10.2026', 'Мастер ДЕМО-2'],
        ['2.2', 'Стажировка по должности', 'Цех ДЕМО', 'с 15.10.2026 по 30.10.2026', 'Мастер ДЕМО-2'],
        ['3', 'Проверка знаний по ОТ', 'Цеховая комиссия', '', 'Начальник цеха ДЕМО']
      ]
    },
    { p: '3 Тематический план индивидуальной программы подготовки' },
    { p: o.dropTheory ? '3.1 Перечень тем (таблица оформлена не по форме)' : '3.1 Тематический план теоретической подготовки' },
    o.dropTheory ? { t: [['Тема', 'Часы'], ['Охрана труда', '10']] } : { t: theory },
    { p: '3.2 Тематический план стажировки' },
    {
      t: [
        ['Номер курса, раздела, темы', 'Наименование курса, раздела, темы', 'Место проведения стажировки', 'Продолжительность стажировки (часы)', 'Должность, фамилия, инициалы ответственного за стажировку', 'Отметка о выполнении'],
        ['1', ['Охрана труда на рабочем месте', 1], ['8', 1], ['', 2]],
        ['1.1', 'Выполнение требований охраны труда', 'Цех ДЕМО', '8', 'Мастер ДЕМО-2', ''],
        ['2', ['Стажировка по должности', 1], ['12', 1], ['', 2]],
        ['2.1', 'Обслуживание демонстрационного оборудования', 'Цех ДЕМО', '12', '', '']
      ]
    },
    { p: '4 Оценка обучения' },
    { p: '4.1 Оценка обучения направлена на выявление недостатков процесса обучения.' },
    { p: 'Приложение А Протокол выходного контроля уровня знаний' },
    { p: 'Приложение Б Оценка обучения' },
    { p: 'Библиография' },
    { p: '[1] I.К1.Т13.УМСИ.ДЕМО.0101.2024 Учебный материал для самостоятельного изучения «Средства коллективной и индивидуальной защиты»' },
    { p: '[2] I.К1.Т20.УМСИ.ДЕМО.0103.2022 Учебный материал для самостоятельного изучения «Порядок допуска к работам»' },
    { p: '[3] I.К5.Т5.ПАЗ.ДЕМО.0102.2021 План аудиторного занятия «Первичные средства пожаротушения»' },
    { p: '[4] II.К6.Т11.УМСИ.ДЕМО.0104.2021 Учебный материал для самостоятельного изучения «Основы культуры безопасности»' },
    { p: '[5] III.К18.Т1.ПАЗ.ДЕМО.0105.2023 План аудиторного занятия «Конструкция оборудования»' },
    { p: '[6] I.К4.Т3.УМСИ.ДЕМО.0109.2022 Учебный материал для самостоятельного изучения «Радиационная безопасность»' },
    { p: '[7] I.К2.Т4.УМСИ.ДЕМО.0106.2024 Учебный материал для самостоятельного изучения «Нормативные требования к оборудованию»' },
    { p: '[8] II.К7.Т3.УМСИ.ДЕМО.0108.2024 Учебный материал для самостоятельного изучения «Командная работа»' },
    {
      p: 'Примечание - При использовании настоящей программы целесообразно проверить актуальность применяемых в ней ссылочных документов.'
    },
    { p: 'Приложение Протокол входного контроля уровня знаний' },
    { t: [['С программой ознакомлен: работник ДЕМО-001', 'РАЗРАБОТАНО: Инструктор ДЕМО-1'], ['«____»_________ 2026 г.', '«____»_________ 2026 г.']] }
  ]
}

// ——— УММ ———

export interface UmmCard {
  designation: string
  title: string
  revision?: string
  status?: string
  validFrom?: string
  validTo?: string
  reviewDue?: string
  approvedAt?: string
  replaces?: string
  replacedBy?: string
  asutdStamp?: string
}

export function ummBlocks(c: UmmCard): { blocks: Block[]; footer?: string } {
  const rows: [string, string | undefined][] = [
    ['Обозначение', c.designation],
    ['Наименование', c.title],
    ['Изменение', c.revision],
    ['Статус', c.status],
    ['Дата утверждения', c.approvedAt],
    ['Дата введения в действие', c.validFrom],
    ['Дата окончания действия', c.validTo],
    ['Срок пересмотра', c.reviewDue],
    ['Взамен', c.replaces],
    ['Заменён на', c.replacedBy]
  ]
  return {
    blocks: [
      { p: SYNTH, bold: true },
      { p: 'Учебно-методический материал (синтетика)', center: true, bold: true },
      { p: `«${c.title}»`, center: true },
      { t: rows.filter(([, v]) => v).map(([k, v]) => [k, v!]) },
      { p: '1 Цели занятия' },
      { p: 'Текст учебного материала отсутствует: документ создан только для проверки реквизитов.' }
    ],
    footer: c.asutdStamp
  }
}

// ——— Реестр XLSX (минимальная книга с inline-строками) ———

const xmlEsc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export async function buildXlsx(rows: string[][], sheetName = 'Реестр'): Promise<Buffer> {
  const zip = new JSZip()
  const col = (i: number) => String.fromCharCode(65 + i)
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'
  )
  zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${xmlEsc(sheetName)}" sheetId="1" r:id="rId1"/></sheets></workbook>`
  )
  zip.file('xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>')
  const body = rows
    .map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => (v ? `<c r="${col(ci)}${ri + 1}" t="inlineStr"><is><t>${xmlEsc(v)}</t></is></c>` : '')).join('')}</row>`)
    .join('')
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${body}</sheetData></worksheet>`)
  return zip.generateAsync({ type: 'nodebuffer' })
}

/** Минимальный PDF без текстового слоя — имитация скана. */
export function buildBlankPdf(): Buffer {
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >>'
  ]
  let out = '%PDF-1.4\n'
  const offsets: number[] = []
  objs.forEach((o, i) => {
    offsets.push(out.length)
    out += `${i + 1} 0 obj\n${o}\nendobj\n`
  })
  const xref = out.length
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(out, 'latin1')
}

export const DEMO_UMM: { file: string; card: UmmCard }[] = [
  {
    file: 'УММ I.К1.Т13.УМСИ.ДЕМО.0101.2024 (действует).docx',
    card: { designation: 'I.К1.Т13.УМСИ.ДЕМО.0101.2024', title: 'Средства коллективной и индивидуальной защиты', revision: '0', status: 'Действующий', approvedAt: '15.01.2024', validFrom: '01.02.2024', validTo: '31.12.2029', reviewDue: '31.12.2027' }
  },
  {
    file: 'УММ I.К5.Т5.ПАЗ.ДЕМО.0102.2021 (срок истёк).docx',
    card: { designation: 'I.К5.Т5.ПАЗ.ДЕМО.0102.2021', title: 'Первичные средства пожаротушения', status: 'Действующий', approvedAt: '10.03.2021', validFrom: '01.04.2021', validTo: '31.12.2025' }
  },
  {
    file: 'УММ I.К1.Т20.УМСИ.ДЕМО.0103.2022 (заменён).docx',
    card: { designation: 'I.К1.Т20.УМСИ.ДЕМО.0103.2022', title: 'Порядок допуска к работам', status: 'Заменён', validFrom: '01.06.2022', replacedBy: 'I.К1.Т20.УМСИ.ДЕМО.0207.2025' }
  },
  {
    file: 'УММ I.К1.Т20.УМСИ.ДЕМО.0207.2025 (замена).docx',
    card: { designation: 'I.К1.Т20.УМСИ.ДЕМО.0207.2025', title: 'Порядок допуска к работам', status: 'Действующий', approvedAt: '20.05.2025', validFrom: '01.06.2025', validTo: '31.05.2030', replaces: 'I.К1.Т20.УМСИ.ДЕМО.0103.2022' }
  },
  {
    file: 'УММ II.К6.Т11.УМСИ.ДЕМО.0104.2021 (просрочен пересмотр).docx',
    card: { designation: 'II.К6.Т11.УМСИ.ДЕМО.0104.2021', title: 'Основы культуры безопасности', status: 'Действующий', approvedAt: '01.07.2021', validFrom: '01.07.2021', reviewDue: '30.06.2026' }
  },
  {
    file: 'УММ III.К18.Т1.ПАЗ.ДЕМО.0105.2023 изм.1.docx',
    card: { designation: 'III.К18.Т1.ПАЗ.ДЕМО.0105.2023', title: 'Конструкция оборудования', revision: '1', status: 'Действующий', validFrom: '01.03.2023', validTo: '28.02.2025' }
  },
  {
    file: 'УММ III.К18.Т1.ПАЗ.ДЕМО.0105.2023 изм.2.docx',
    card: { designation: 'III.К18.Т1.ПАЗ.ДЕМО.0105.2023', title: 'Конструкция оборудования', revision: '2', status: 'Действующий', validFrom: '01.03.2025', validTo: '28.02.2030', asutdStamp: 'АСУТД-2. Действующий. № 99105 от 01.03.2025. Печать 01.11.2026.' }
  },
  {
    file: 'УММ I.К5.Т36.УМСИ.ДЕМО.0110.2023 (есть новый номер).docx',
    card: { designation: 'I.К5.Т36.УМСИ.ДЕМО.0110.2023', title: 'Пожарная безопасность', status: 'Действующий', validFrom: '01.02.2023', validTo: '31.01.2028' }
  },
  {
    file: 'УММ I.К5.Т36.УМСИ.ДЕМО.0215.2026 (новый УММ той же темы).docx',
    card: { designation: 'I.К5.Т36.УМСИ.ДЕМО.0215.2026', title: 'Пожарная безопасность', status: 'Действующий', validFrom: '01.09.2026', validTo: '31.08.2031' }
  },
  {
    file: 'УММ I.К2.Т4.УМСИ.ДЕМО.0106.2024 (расходится с реестром).docx',
    card: { designation: 'I.К2.Т4.УМСИ.ДЕМО.0106.2024', title: 'Нормативные требования к оборудованию', status: 'Действующий', validFrom: '01.09.2024', validTo: '31.10.2026' }
  }
]

/** Новая редакция УММ 0101.2024 под новым номером — для сценария «добавить УММ и перепроверить». */
export const DEMO_EXTRA_UMM: { file: string; card: UmmCard } = {
  file: 'УММ I.К1.Т13.УМСИ.ДЕМО.0301.2026 (новая редакция).docx',
  card: { designation: 'I.К1.Т13.УМСИ.ДЕМО.0301.2026', title: 'Средства коллективной и индивидуальной защиты', status: 'Действующий', approvedAt: '20.11.2026', validFrom: '25.11.2026', validTo: '30.11.2031' }
}

export const DEMO_REGISTRY: string[][] = [
  ['Реестр УММ — СИНТЕТИЧЕСКИЕ ДАННЫЕ ДЛЯ ДЕМОНСТРАЦИИ'],
  ['Обозначение', 'Наименование', 'Изменение', 'Статус', 'Статус на дату', 'Дата введения', 'Дата окончания', 'Срок пересмотра', 'Заменён на'],
  ['I.К1.Т13.УМСИ.ДЕМО.0101.2024', 'Средства коллективной и индивидуальной защиты', '0', 'Действующий', '01.11.2026', '01.02.2024', '31.12.2029', '31.12.2027', ''],
  ['I.К2.Т4.УМСИ.ДЕМО.0106.2024', 'Нормативные требования к оборудованию', '', 'Действующий', '01.11.2026', '01.09.2024', '31.12.2028', '', ''],
  ['II.К7.Т3.УМСИ.ДЕМО.0108.2024', 'Командная работа', '', 'Отменён', '01.11.2026', '01.02.2024', '', '', '']
]

export const DEMO_CHECK_DATE = '2026-12-01'

// ——— Образец УММ в оформлении документов АСУТД (как П.00.10): титульный лист, предисловие, колонтитулы ———

export const ASUTD_UMM = {
  designation: 'I.К5.Т40.УМСИ.ДЕМО.0401.2025',
  header: 'I.К5.Т40.УМСИ.ДЕМО.0401.2025 «зам» 2',
  stamp: 'АСУТД-2. Действующий. № 99401 от 20.01.2025. Печать 01.11.2026.',
  lines: [
    SYNTH,
    'Филиал «Демонстрационная атомная станция»',
    'УТВЕРЖДАЮ',
    'Начальник УТП ДЕМО',
    '(подпись)',
    '«15» января 2025 г.',
    'Учебный материал для самостоятельного изучения',
    '«Средства пожаротушения»',
    'I.К5.Т40.УМСИ.ДЕМО.0401.2025',
    'Дата введения в действие 01.02.2025',
    'Дата окончания действия 31.01.2030',
    'Предисловие',
    '1 РАЗРАБОТАН Учебно-тренировочным подразделением (синтетика)',
    '2 ВВЕДЕН В ДЕЙСТВИЕ распоряжением от 20.01.2025 № 9/ДЕМО-1',
    '3 ВЗАМЕН Учебного материала «Средства пожаротушения»',
    'I.К5.Т40.УМСИ.ДЕМО.0220.2021, утверждённого 10.03.2021.',
    '1 Цели изучения',
    'Текст учебного материала отсутствует: документ создан только для проверки чтения реквизитов.'
  ]
}

export const buildAsutdUmmDocx = () => buildDocx(ASUTD_UMM.lines.map((l) => ({ p: l })), ASUTD_UMM.stamp, ASUTD_UMM.header)
