// Генерирует синтетический демонстрационный комплект в каталоге demo/.
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DEMO_CHECK_DATE, DEMO_EXTRA_UMM, buildAsutdUmmDocx, DEMO_REGISTRY, DEMO_UMM, buildBlankPdf, buildDocx, buildXlsx, demoIppdBlocks, ummBlocks } from './demoBuilder'

const out = join(__dirname, '..', 'demo')

async function main() {
  mkdirSync(join(out, 'УММ'), { recursive: true })
  writeFileSync(join(out, 'ИППД.99.ДЕМО.001 (синтетика).docx'), await buildDocx(demoIppdBlocks()))
  for (const u of DEMO_UMM) {
    const { blocks, footer } = ummBlocks(u.card)
    writeFileSync(join(out, 'УММ', u.file), await buildDocx(blocks, footer))
  }
  writeFileSync(join(out, 'УММ', 'ИОТ.99.01 изм.3 (скан).pdf'), buildBlankPdf())
  mkdirSync(join(out, 'дополнительно'), { recursive: true })
  const extra = ummBlocks(DEMO_EXTRA_UMM.card)
  writeFileSync(join(out, 'дополнительно', DEMO_EXTRA_UMM.file), await buildDocx(extra.blocks, extra.footer))
  // Образцы форм УММ: DOCX здесь, PDF — отдельным скриптом через Electron (npm run demo:pdf)
  mkdirSync(join(out, 'образцы форм УММ'), { recursive: true })
  writeFileSync(join(out, 'образцы форм УММ', 'УММ АСУТД (синтетика).docx'), await buildAsutdUmmDocx())
  writeFileSync(join(out, 'Реестр УММ (синтетика).xlsx'), await buildXlsx(DEMO_REGISTRY))
  writeFileSync(
    join(out, 'manifest.json'),
    JSON.stringify(
      {
        note: 'Синтетический комплект. Все обозначения, ФИО и даты вымышлены.',
        checkDate: DEMO_CHECK_DATE,
        profile: 'demo',
        ippd: 'ИППД.99.ДЕМО.001 (синтетика).docx',
        umm: [...DEMO_UMM.map((u) => `УММ/${u.file}`), 'УММ/ИОТ.99.01 изм.3 (скан).pdf'],
        registry: 'Реестр УММ (синтетика).xlsx',
        extraUmm: `дополнительно/${DEMO_EXTRA_UMM.file}`
      },
      null,
      2
    )
  )
  console.log('Демо-комплект записан в', out)
}
main()
