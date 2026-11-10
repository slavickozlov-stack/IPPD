// Записывает JSON-схему профиля правил в schemas/profile.schema.json (для редакторов и внешней проверки).
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { profileSchema } from '../src/core/profile'

writeFileSync(join(__dirname, '..', 'schemas', 'profile.schema.json'), JSON.stringify({ $schema: 'http://json-schema.org/draft-07/schema#', ...profileSchema }, null, 2))
console.log('schemas/profile.schema.json обновлена')
