import re

# Read the file
with open('c:/tmp/crm-fresh/frontend/src/App.js', 'r', encoding='utf-8') as f:
    content = f.read()

# Find the location after "Fora do perfil" checkbox and before the "Visível apenas para mim" checkbox
# We'll insert the new fields right after the "Fora do perfil" div closes

pattern = r"(                  <label\s+htmlFor=\"lead-out-of-scope\"\s+className=\"text-xs font-semibold text-slate-700\"\s*>\s*Fora do perfil\s*</label>\s*</div>)"

new_ui = r'''\1

                <div className="pt-2 border-t border-slate-100">
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    Tipo de Cliente
                  </label>
                  <div className="flex gap-2">
                    {CUSTOMER_TYPE_OPTIONS.map((type) => (
                      <button
                        key={type}
                        type="button"
                        onClick={() => setLeadForm({ ...leadForm, customer_type: type })}
                        className={`flex-1 py-1 px-3 text-sm rounded-lg border transition ${
                          leadForm.customer_type === type
                            ? 'bg-blue-600 text-white border-blue-600'
                            : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                        }`}
                      >
                        {type}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    Categorias em destaque (múltipla escolha)
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {HIGHLIGHTED_CATEGORIES_OPTIONS.map((cat) => {
                      const selected = (leadForm.highlighted_categories || '').split(',').includes(cat);
                      return (
                        <button
                          key={cat}
                          type="button"
                          onClick={() => {
                            let current = (leadForm.highlighted_categories || '').split(',').filter(Boolean);
                            if (selected) {
                              current = current.filter((c) => c !== cat);
                            } else {
                              current.push(cat);
                            }
                            setLeadForm({ ...leadForm, highlighted_categories: current.join(',') });
                          }}
                          className={`text-[10px] py-1 px-2 rounded-full border transition ${
                            selected
                              ? 'bg-emerald-600 text-white border-emerald-600'
                              : 'bg-white text-slate-500 border-slate-200 hover:border-emerald-300'
                          }`}
                        >
                          {cat}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-2">
                    Motivo de esfriamento (múltipla escolha)
                  </label>
                  <div className="flex flex-wrap gap-1">
                    {COOLING_REASON_OPTIONS.map((reason) => {
                      const selected = (leadForm.cooling_reason || '').split(',').includes(reason);
                      return (
                        <button
                          key={reason}
                          type="button"
                          onClick={() => {
                            let current = (leadForm.cooling_reason || '').split(',').filter(Boolean);
                            if (selected) {
                              current = current.filter((r) => r !== reason);
                            } else {
                              current.push(reason);
                            }
                            setLeadForm({ ...leadForm, cooling_reason: current.join(',') });
                          }}
                          className={`text-[10px] py-1 px-2 rounded-full border transition ${
                            selected
                              ? 'bg-amber-600 text-white border-amber-600'
                              : 'bg-white text-slate-500 border-slate-200 hover:border-amber-300'
                          }`}
                        >
                          {reason}
                        </button>
                      );
                    })}
                  </div>
                </div>
'''

content = re.sub(pattern, new_ui, content, count=1)

# Write back
with open('c:/tmp/crm-fresh/frontend/src/App.js', 'w', encoding='utf-8') as f:
    f.write(content)

print("Successfully added UI components to the lead modal")
