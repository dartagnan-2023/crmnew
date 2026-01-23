import re

# Read the file
with open('c:/tmp/crm-fresh/frontend/src/App.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Add new options after SEGMENT_OPTIONS
segment_pattern = r"(const SEGMENT_OPTIONS = \[[\s\S]*?\];)"
new_options = r"""\1

const HIGHLIGHTED_CATEGORIES_OPTIONS = [
  'Automação',
  'Baixa Tensão',
  'Comando e Sinalização',
  'Instrumentos e Medições',
  'Conectividade e Proteção',
  'Ventilação e Filtragem',
  'Ferramentas',
  'Pneumática',
];

const CUSTOMER_TYPE_OPTIONS = ['A', 'B', 'C'];

const COOLING_REASON_OPTIONS = [
  'Preço',
  'Problemas técnicos',
  'Não lembrava',
  'Crédito/Outros',
];"""

content = re.sub(segment_pattern, new_options, content, count=1)

# Add new fields to emptyLead
empty_lead_pattern = r"(first_contact: '',)\s*(\};)"
new_fields = r"""\1
  highlighted_categories: '',
  customer_type: '',
  cooling_reason: '',
\2"""

content = re.sub(empty_lead_pattern, new_fields, content, count=1)

# Write back
with open('c:/tmp/crm-fresh/frontend/src/App.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Successfully updated App.js with new field options and emptyLead fields")
