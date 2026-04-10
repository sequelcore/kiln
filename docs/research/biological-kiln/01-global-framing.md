# 01 Global Framing

## Research Prompt

```
You are a senior research architect working on Kiln, an AI orchestration engine.

Kiln is a Bun/TypeScript monorepo with 7 packages (core, runtime, cli, tui, sdk, widget, studio).
It provides: 7 engine primitives, multi-tenant gateway, 8 channel adapters (CLI, Web, WhatsApp, Instagram, Messenger, Slack, Email, API), safety pipeline, memory (SQLite + FTS5), knowledge RAG (PgVector, Cohere reranker), eval (23 scorers), and coordination intelligence (ThresholdAllocator, CascadeController, TaskChannel, TeamComposer).

It also acts as a cross-CLI meta-orchestrator routing between Claude Code, Codex CLI, and OpenCode.

Kiln vision:
- neurological
- biocybernetic
- biologically grounded
- cyberpunk / steampunk in identity, but functionally grounded
- engine-first, not surface-first

Kiln vectors (use these names when mapping):
- orchestration
- routing
- coordination intelligence
- memory
- context governance
- safety and security
- tool execution
- approvals and trust boundaries
- continuity and session state
- observability
- resilience and fallback
- product surfaces: TUI, SDK, Studio, widget

Your task:
Produce a rigorous research brief on which biological and cybernetic systems are most useful for Kiln.

Rules:
- no metaphor-only writing
- no fluff
- no generic biomimicry language
- prioritize mechanisms that can become real software invariants, control loops, memory models, or routing systems
- separate what is biologically accurate from what is only an engineering analogy
- call out where the analogy breaks

Analyze these candidate domains:
- nervous systems
- cognitive neuroscience and memory systems
- immune systems
- homeostasis and allostasis
- swarm intelligence and stigmergy
- fungal / mycelial networks
- morphogenesis and developmental biology
- biomachines / cybernetics / sensor-actuator systems

For each domain, provide:
1. Core biological mechanisms
2. Best software abstractions
3. Direct application to Kiln
4. Which Kiln vectors it best fits
5. Risks of misuse
# Kiln: brief riguroso de sistemas biológicos y cibernéticos para invariantes de arquitectura

## Mechanisms

Este brief trata cada dominio como un **repositorio de mecanismos** (biológicamente sustentados) que pueden traducirse a **invariantes de software**: modelos explícitos de estado, señales, refuerzo/inhibición, memoria/olvido y control de estabilidad. Donde exista debate científico o la evidencia sea indirecta, lo marco como **analogía de ingeniería** (no como “verdad biológica”).

### Sistema nervioso

**Mecanismo biológico probado**  
La señalización neuronal se organiza alrededor de: (a) propagación de eventos (potenciales de acción) y transmisión sináptica; (b) plasticidad sináptica dependiente de actividad y temporización; (c) estabilización por balance excitación/inhibición y regulación de entradas/salidas; (d) aprendizaje guiado por señales neuromoduladoras (p.ej., dopamina) que codifican errores de predicción de recompensa y ajustan selección/actualizaciones. La plasticidad dependiente del tiempo (STDP) muestra que la **dirección y magnitud** del cambio sináptico depende del orden temporal entre disparos pre- y postsinápticos (ventanas temporales de potenciación/depresión). citeturn0search4turn0search0 La evidencia clásica y revisiones posteriores sobre dopamina sostienen que neuronas dopaminérgicas registran **diferencias entre recompensa recibida y esperada** (reward prediction error), señal que guía aprendizaje por refuerzo. citeturn5search0turn5search28 La estabilidad local/global en circuitos corticales depende de co-regulación entre entradas excitatorias e inhibitorias (E/I balance), cuyo desacople se asocia con inestabilidad dinámica y disfunción. citeturn5search3turn5search15 La codificación predictiva (predictive coding) describe arquitecturas jerárquicas donde señales top‑down codifican **predicciones** y señales bottom‑up codifican **errores** para corregir el estado interno; en formulaciones modernas se conecta con marcos Bayesianos/variacionales. citeturn5search26turn5search2

**Estado, señales y memoria: respuestas obligatorias**  
Estado: activaciones distribuidas + pesos sinápticos (con escalas temporales múltiples). citeturn0search4turn5search3  
Señales que se propagan: eventos discretos (spikes), errores de predicción, y moduladores globales (p.ej., dopamina). citeturn5search26turn5search0  
Qué se refuerza: asociaciones temporales útiles (STDP) y políticas/acciones que mejoran predicciones/recompensa. citeturn0search4turn5search28  
Qué se inhibe: actividad excesiva mediante inhibición y mecanismos homeostáticos; supresión competitiva para estabilizar representaciones. citeturn5search3  
Qué se recuerda: cambios de conectividad (pesos), patrones estabilizados. citeturn0search4  
Qué se olvida: debilitamiento/depresión sináptica y renormalización (en interacción con sueño/homeostasis sináptica; ver memoria). citeturn2search3  
Qué mantiene estabilidad bajo presión: E/I balance + control homeostático de actividad. citeturn5search3  
Equivalente “limpio” en Kiln: **red de enrutamiento y gating** donde (i) eventos de ejecución son “spikes”; (ii) errores/residuos alimentan correcciones; (iii) señales globales (evaluaciones) actúan como moduladores.

**Abstracción computacional (no afirmación biológica)**  
1) **Event routing con ventanas temporales**: si A→B ocurre consistentemente y produce buen resultado, aumenta la “sinaptización” A→B; si ocurre fuera de ventana o produce error, se deprime (STDP como regla de actualización acotada).  
2) **Predicción‑error como “delta de contexto”**: transmitir y registrar deltas (lo inesperado) en vez de estados completos (predictive coding como compresión operacional).  
3) **Gating de acción**: separar “proponer acciones” vs “autorizar ejecución” (basal ganglia como inspiración de gating; con estimadores de valor/criterios). citeturn5search1turn5search25

**Mapeo directo a Kiln**  
- En **routing** y **tool execution**, el “circuito” a diseñar es un **router de decisiones** que decide: herramienta / canal / orquestador externo / escalamiento humano.  
- Los 23 scorers de eval pueden operar como señal moduladora “global” para ajustar políticas de router y coordinación (aprendizaje acotado, no auto‑modificación libre). citeturn5search28  
- En **observability**, predictive coding sugiere que el sistema debe registrar explícitamente *predicho vs observado* para cada ejecución (latencia, coste, errores, compliance) y propagar el residual como señal de corrección. citeturn5search26

**Riesgo probable de implementación**  
Actualizaciones tipo STDP o “aprendizaje en vivo” pueden crear **retroalimentación positiva** (sesgos de ruta, colapso a un camino) si no se acotan tasas, se añade exploración, o no se controla por políticas “inhibitorias” (límite de cambio por sesión/tenant). El balance E/I en biología es resultado de múltiples mecanismos; en software, si se simplifica a un único rate‑limit, es fácil inducir oscilaciones.

**Dónde se rompe la analogía**  
En biología, la plasticidad está distribuida, lenta y ruidosa; en software, actualizaciones discretas pueden ser abruptas y no tolerar fallos. Además, predictive coding como teoría no garantiza que una arquitectura de “errores” sea óptima fuera del dominio sensorial; su aplicación a orquestación es **analogía de ingeniería**, no equivalencia biológica. citeturn5search26turn5search2

**Priority score para Kiln**: 8/10 (alto por enrutamiento + gobernanza de contexto; riesgo por inestabilidad si se “aprende” sin control).

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["spike timing dependent plasticity synapse diagram","predictive coding brain hierarchical error signal diagram","germinal center B cell affinity maturation diagram","ant pheromone trail stigmergy diagram"],"num_per_query":1}

### Neurociencia cognitiva y sistemas de memoria

**Mecanismo biológico probado**  
Los sistemas de memoria en mamíferos no son monolíticos: distintos circuitos soportan formas diferentes (y a veces competidoras) de memoria (hipocampo, estriado, amígdala, etc.). citeturn0search1turn0search5 La teoría de indexación hipocampal propone que el hipocampo forma/retiene un “índice” de patrones neocorticales co‑activados, útil para reinstanciar la experiencia. citeturn6search25turn6search1 En memoria de trabajo, existe evidencia tanto para modelos de **actividad persistente** como para mecanismos “silenciosos” (activity‑silent) que interactúan con dinámica tipo atractor para mantener información durante demoras. citeturn6search16turn6search0 Para consolidación y escalas temporales, revisiones discuten que memorias declarativas sufren consolidación de sistema donde la traza necesaria para recall cambia de dependencia hipocampal hacia redes corticales (con matices y debates). citeturn0search13 Sobre olvido/renormalización: la hipótesis de homeostasis sináptica (SHY) sostiene que sueño ayuda a renormalizar fuerzas sinápticas tras potenciación neta en vigilia; es influyente pero también discutida. citeturn9search3turn2search3turn9search26

**Estado, señales y memoria: respuestas obligatorias**  
Estado: trazas en múltiples almacenes (hipocampo/corteza; trabajo/largo plazo) y estados latentes vs activos. citeturn6search25turn6search0  
Señales: patrones de co‑activación; reactivación/replay; neuromodulación que etiqueta relevancia/saliencia; oscilaciones/sueño como contexto fisiológico. citeturn9search11turn5search28  
Qué se refuerza: asociaciones con saliencia y co‑ocurrencia; consolidación de regularidades. citeturn6search25turn9search11  
Qué se inhibe: interferencia entre memorias (competencia entre sistemas), y sobrecarga sináptica mediante renormalización (hipótesis). citeturn0search1turn2search3  
Qué se recuerda: índices/engramas y representaciones generalizadas (según sistema). citeturn6search25turn0search13  
Qué se olvida: debilitamiento/recorte/renormalización; “olvido funcional” para liberar capacidad (hipótesis y evidencias indirectas). citeturn2search3turn9search26  
Qué mantiene estabilidad bajo presión: separación en subsistemas + mecanismos de control de interferencia/capacidad. citeturn0search1turn6search0  
Equivalente “limpio” en Kiln: **memoria multi‑nivel** con reglas explícitas para: (i) mantener estado de sesión (trabajo), (ii) registrar episodios, (iii) consolidar a representaciones semánticas/buscables, (iv) olvidar con garantías.

**Abstracción computacional (no afirmación biológica)**  
1) **Índice episódico + rehidratación**: un “hipocampo” de Kiln = índices de sesiones/episodios que apuntan a artefactos (logs, tool traces, prompts, outputs), con rehidratación controlada.  
2) **Separación trabajo vs largo plazo**: memoria de trabajo = ventana de contexto activa (RAM/estado), memoria de largo plazo = SQLite+FTS5 y base vectorial; reglas para mover y resumir (consolidación).  
3) **Olvido como invariante**: diseñar olvido explícito (TTL, decaimiento, pruning semántico) para estabilidad y privacidad.

**Mapeo directo a Kiln**  
- **memory** y **continuity and session state** son el match principal: sesión = memoria de trabajo; historial/FTS5 = memoria episódica; RAG (PgVector + reranker de entity["company","Cohere","ai company, toronto"]) = memoria semántica con recuperación controlada.  
- La separación de subsistemas ayuda a **context governance**: qué entra al contexto de inferencia (trabajo) vs qué queda como recuperación bajo demanda (semántico), minimizando “interferencia” (prompt bloat). citeturn0search1turn6search0  
- SHY (aunque debatida) es útil como analogía de “renormalización programada” (batch jobs nocturnos): compactación, deduplicación, down‑weight de rutas/recuerdos “sobre‑potenciados”. citeturn2search3turn9search26

**Riesgo probable de implementación**  
- “Consolidar” mal puede **borrar contexto de seguridad** o degradar trazabilidad.  
- La traducción literal de SHY (“reset global”) puede destruir conocimiento raro pero crítico; requiere métricas de valor y *retention policies* por tenant.

**Dónde se rompe la analogía**  
La memoria biológica no es un almacén transaccional; está ligada a plasticidad, reconsolidación y contexto. En software, hay obligación de reproducibilidad/auditoría; por tanto, “olvido” de Kiln debe separarse en **olvido operacional (ranking/recall)** vs **retención legal/audit (append‑only)**, cosa que no tiene un análogo limpio en neurociencia.

**Priority score para Kiln**: 10/10 (es directamente arquitectura de memoria y continuidad).

### Sistema inmune

**Mecanismo biológico probado**  
La inmunidad innata reconoce patrones conservados (PAMPs) y señales de daño (DAMPs) mediante receptores de reconocimiento de patrones (PRRs), iniciando respuestas rápidas y condicionando la activación de inmunidad adaptativa. citeturn1search1turn1search13 La dinámica adaptativa incluye centros germinales: expansión clonal de células B, hipermutación somática (SHM) y selección por afinidad, resultando en maduración de afinidad de anticuerpos. citeturn0search6turn0search14turn0search10 Mecanismos reguladores (checkpoints) como PD‑1 y CTLA‑4 funcionan como reguladores negativos de función T, limitando daño por sobreactivación e influyendo en tolerancia. citeturn4search1turn4search17 La tolerancia central se implementa en el timo mediante selección positiva/negativa de timocitos en función de señalización de TCR, reduciendo autorreactividad (no infalible). citeturn4search20turn4search28 Complemento y cascadas amplificatorias requieren regulación: factor H es un regulador soluble clave del camino alternativo, limitando activación inapropiada sobre “self”. citeturn4search2turn4search10 La resolución de inflamación es un proceso activo; mediadores pro‑resolutivos especializados ayudan a finalizar respuesta y restaurar homeostasis. citeturn4search27turn4search23

**Estado, señales y memoria: respuestas obligatorias**  
Estado: repertorio de receptores (innato) + repertorio adaptativo (clones) + memoria inmunológica; umbrales de activación e inhibición. citeturn0search10turn1search1  
Señales: PAMP/DAMP→PRR; citocinas; cascadas (complemento); checkpoints inhibitorios. citeturn1search1turn4search2turn4search1  
Qué se refuerza: clones con mayor “afinidad” vía ciclos de mutación/selección en centros germinales. citeturn0search10turn0search6  
Qué se inhibe: autorreactividad y sobreactivación vía selección negativa y checkpoints; control de cascadas (factor H). citeturn4search20turn4search1turn4search2  
Qué se recuerda: memoria inmunológica (células de memoria; anticuerpos persistentes). citeturn0search10turn0search14  
Qué se olvida: contracción post‑respuesta; resolución activa de inflamación. citeturn4search27  
Qué mantiene estabilidad bajo presión: capas (innata/adaptativa), inhibidores/checkpoints, y procesos de resolución. citeturn4search17turn4search27  
Equivalente “limpio” en Kiln: **pipeline de seguridad en capas** (detección rápida → escalamiento especializado → memoria de amenazas → tolerancia/checkpoints → resolución).

**Abstracción computacional (no afirmación biológica)**  
1) **PRR como “detectores de patrón”**: firmas/heurísticas de ataque, jailbreak, exfiltración, prompt injection, tool misuse; activan respuestas rápidas y baratas.  
2) **Centros germinales como “entrenamiento/selección interna”**: generar variantes de reglas/políticas (mutación controlada) y seleccionar por desempeño en suites de evaluación adversarial (los 23 scorers y conjuntos rojos).  
3) **Checkpoints/tolerancia**: reglas de “no‑ejecución” + “requiere aprobación” + “degradar permisos” por tenant/canal/herramienta.

**Mapeo directo a Kiln**  
- **safety and security** y **approvals and trust boundaries**: el sistema inmune ofrece un marco directamente accionable para: (i) defensas rápidas (innate) antes de tool execution; (ii) defensas lentas (adaptive) basadas en aprendizaje/selección offline; (iii) inhibición para reducir falsos positivos y daño colateral. citeturn1search1turn4search1turn0search10  
- **context governance**: PRRs pueden operar sobre *representaciones* del contexto y del plan (no sólo texto crudo), detectando patrones en grafos de herramientas/acciones.  
- Con multi‑tenant gateway, el análogo “self vs non‑self” se parece más a **perímetros y políticas por tenant** que a identidad biológica; la regulación por factor H sugiere mantener **inhibidores** para cascadas de bloqueo (p.ej., evitar “lockdown total” por un falso evento). citeturn4search2turn4search10

**Riesgo probable de implementación**  
- **Auto‑inmunidad de seguridad**: reglas demasiado agresivas bloquean funcionalidad (falsos positivos), especialmente en orquestación multi‑canal.  
- **Evasión adversarial**: si “PRRs” son demasiado deterministas, un atacante aprende a rodearlos; si son demasiado plásticos, se vuelven inestables.  
- **Cascadas**: bloquear componentes aguas arriba puede apagar servicios enteros (analogía con complemento mal regulado). citeturn4search2turn4search10

**Dónde se rompe la analogía**  
El sistema inmune opera sobre biología con costosas consecuencias; en software, la prioridad incluye UX, latencia y costos. Además, la distinción self/non‑self es imperfecta incluso en inmunología (tolerancia no es absoluta), por lo que “mapeo literal” a confianza/tenant puede inducir modelos mentales incorrectos. citeturn4search4turn4search28

**Priority score para Kiln**: 9/10 (máximo encaje con safety/trust; debe diseñarse para evitar auto‑bloqueos).

### Homeostasis y allostasis

**Mecanismo biológico probado**  
Homeostasis refiere a mantener variables internas relativamente estables mediante **lazos de retroalimentación negativa**; no es estado fijo, se ajusta dinámicamente ante desafíos. citeturn1search0turn1search12 Allostasis (“estabilidad a través del cambio”) extiende el marco: el organismo ajusta puntos de operación y respuestas anticipatorias/compensatorias bajo estrés; “allostatic load” describe costo acumulado por activación crónica. citeturn0search7turn0search3

**Estado, señales y memoria: respuestas obligatorias**  
Estado: variables reguladas + setpoints que pueden moverse (allostasis) + historia de perturbaciones (carga). citeturn0search7turn1search0  
Señales: errores vs setpoint, sensores fisiológicos, mediadores de estrés; retroalimentación negativa. citeturn1search12turn0search7  
Qué se refuerza: estrategias regulatorias que restauran desempeño bajo demanda (a costa de carga si se cronifica). citeturn0search3turn0search7  
Qué se inhibe: desviaciones persistentes; respuestas excesivas mediante frenos regulatorios. citeturn1search12turn0search3  
Qué se recuerda: historial de perturbaciones reflejado en “carga alostática” y ajustes de setpoint. citeturn0search7  
Qué se olvida: retorno a baseline y desactivación de mediadores tras resolución (cuando ocurre). citeturn0search3  
Qué mantiene estabilidad bajo presión: control por feedback + capacidad de cambiar setpoints (allostasis). citeturn0search7turn1search0  
Equivalente “limpio” en Kiln: **control loops explícitos** para latencia, costo, errores, saturación de herramientas, seguridad y calidad; con setpoints adaptativos por canal/tenant.

**Abstracción computacional (no afirmación biológica)**  
1) **Setpoints por “modo operativo”**: normal / degradado / contención / recuperación; setpoints cambian con carga y riesgo.  
2) **Allostatic load como métrica de “estrés del sistema”**: acumulador que integra: incidentes de seguridad, fallos de herramientas, backlog, tiempos de respuesta, variación; cuando supera umbral, el sistema reduce ambición (menos herramientas, más approvals, más caching, rutas más seguras).  
3) **Retroalimentación negativa con anti‑oscilación**: hysteresis, rate‑of‑change limits, y observabilidad robusta.

**Mapeo directo a Kiln**  
- **resilience and fallback** + **observability**: diseñar un “control plane” que mida estado (latencia por canal, tasa de fallos por herramienta, saturación por tenant) y ajuste: concurrencia, timeouts, fallback (p.ej. cambiar de orquestador externo), y políticas de aprobación. citeturn1search0turn0search7  
- **coordination intelligence**: ThresholdAllocator y CascadeController pueden interpretarse como controladores que ajustan asignación de esfuerzo/profundidad del plan en función del error observado vs objetivo de calidad/costo.

**Riesgo probable de implementación**  
Mal diseño de lazo puede producir **oscilaciones** (thrashing entre rutas, toggling de modo), o “fatiga” (allostatic load que nunca baja por mala señalización). La estabilidad biológica incluye redundancia; un controlador único en Kiln es punto de falla.

**Dónde se rompe la analogía**  
La fisiología regula variables continuas con sensores físicos; en software, métricas observables son proxies imperfectos. El equivalente requiere estimación (ver Kalman/cybernetics).

**Priority score para Kiln**: 10/10 (es la base de resiliencia operativa multi‑canal y multi‑tenant).

### Inteligencia de enjambre y estigmergia

**Mecanismo biológico probado**  
La estigmergia describe coordinación indirecta entre agentes mediante huellas en el entorno que guían acciones posteriores; se formalizó en el contexto de insectos sociales y construcción/forrajeo. citeturn10search11turn7search0 En algoritmos inspirados en hormigas, el rastro (feromona) se deposita/refuerza y también se evapora, produciendo rutas preferidas pero adaptativas. En redes, AntNet muestra un enfoque distribuido donde agentes exploran y actualizan tablas de enrutamiento con comunicación indirecta mediada por la propia red. citeturn10search0turn10search9

**Estado, señales y memoria: respuestas obligatorias**  
Estado: huellas en el entorno (feromonas, marcas) + tablas de probabilidad/ruta en cada nodo. citeturn10search0turn10search11  
Señales: deposición/evaporación; señales locales; exploración de agentes. citeturn10search0turn10search9  
Qué se refuerza: rutas con buen desempeño (p.ej., menor congestión/latencia). citeturn10search0  
Qué se inhibe: rutas viejas o subóptimas por evaporación; competencia entre rutas. citeturn10search9  
Qué se recuerda: “memoria externalizada” en el entorno; sesgos probabilísticos acumulados. citeturn10search11  
Qué se olvida: evaporación/TTL que borra rastros. citeturn10search9  
Qué mantiene estabilidad bajo presión: descentralización + exploración continua evita dependencia de un controlador central (con tradeoffs). citeturn10search0  
Equivalente “limpio” en Kiln: **enrutamiento probabilístico + memoria ambiental con decaimiento** para tareas, canales y equipos.

**Abstracción computacional (no afirmación biológica)**  
1) **Pheromone store**: un almacén de señales ligero (TTL + decay) que registra “éxito/latencia/costo” por (tipo de tarea, canal, herramienta, orquestador externo, configuración de seguridad).  
2) **Exploración controlada**: inyectar rutas alternativas con presupuesto (ε‑greedy/Thompson) para evitar lock‑in.  
3) **Stigmergic routing**: TaskChannel publica marcas; Router lee marcas; TeamComposer/ThresholdAllocator usan marcas para asignación.

**Mapeo directo a Kiln**  
- **routing**: especialmente para ruteo entre adaptadores (CLI/Web/entity["company","WhatsApp","messaging app company"]/entity["company","Instagram","social network company"]/Messenger/entity["company","Slack","work chat software company"]/Email/API) y entre meta‑orquestadores (Claude Code, Codex CLI, OpenCode) usando señales de desempeño por canal/tenant. citeturn10search0  
- **coordination intelligence**: asignación emergente (quién ejecuta qué) puede apoyarse en rastros que reflejan congestión/éxito.

**Riesgo probable de implementación**  
- **Herding / path dependence**: pequeñas ventajas iniciales se amplifican; riesgo de inequidad por tenant.  
- **Pheromone poisoning**: actores adversarios o entradas ruidosas pueden sesgar rastros (hacer parecer óptima una ruta insegura).  
- **Dificultad de depuración**: sistemas estigmergicos son menos interpretables si no se instrumentan bien.

**Dónde se rompe la analogía**  
En hormigas, el entorno es físico y la feromona se evapora de forma “natural”; en software, el entorno es un registro que diseñamos. Sin TTL/decay serio y sin defensa contra manipulación, el mecanismo no tiene su propiedad estabilizadora principal.

**Priority score para Kiln**: 8/10 (alto encaje con routing multi‑canal; requiere defensas contra sesgo y manipulación).

### Redes fúngicas y micelio

**Mecanismo biológico probado**  
El micelio fúngico crece como una red interconectada y adaptativa; la estructura de red está ligada a flujos de recursos que a su vez remodelan la arquitectura (feedback estructura↔función). citeturn1search7turn8search5 En análisis de redes fúngicas se enfatiza equilibrio entre eficiencia de transporte, costo de construcción y resiliencia, incluyendo adaptación ante daños/entornos heterogéneos. citeturn1search7turn8search28 La conectividad depende de ramificación y anastomosis (fusión hifal), y se relaciona con robustez a daño (“grazing”) y eficiencia de transporte. citeturn8search28turn8search35 En redes micorrícicas, se ha observado control a nivel de red sobre estructura y flujos (p.ej., “trunk routes” y ajuste de flujos) para satisfacer demandas de intercambio. citeturn8search0

**Estado, señales y memoria: respuestas obligatorias**  
Estado: topología de red (conectividad, diámetros/“trunk routes”) + distribución de recursos. citeturn8search5turn8search0  
Señales: flujos de nutrientes/agua/solutos; señales locales de daño/recurso; retroalimentación por uso. citeturn8search5turn1search7  
Qué se refuerza: rutas con alto flujo (engrosamiento/“trunking”; por analogía funcional). citeturn8search0  
Qué se inhibe: ramas de bajo rendimiento pueden perder inversión (pruning funcional). citeturn1search7turn8search28  
Qué se recuerda: la arquitectura misma como memoria de explotación previa (historial de flujos). citeturn8search5  
Qué se olvida: desinversión de ramas; reconfiguración ante cambios. citeturn1search7turn8search28  
Qué mantiene estabilidad bajo presión: redundancia, conectividad y adaptación progresiva a daños. citeturn8search28  
Equivalente “limpio” en Kiln: **topología adaptativa de ejecución** (paths redundantes, hot paths reforzados, cold paths podados) con objetivos multi‑criterio (coste, estabilidad, seguridad).

**Abstracción computacional (no afirmación biológica)**  
1) **Hot‑path thickening**: si una cadena de herramientas/orquestadores es confiable y frecuente, se “engruesa”: caching, pre‑warm, circuit‑breakers afinados, más observación.  
2) **Redundancia estructural**: mantener rutas alternativas por clase de tarea/tenant (no un único camino feliz).  
3) **Reconfiguración por daño**: si un “nodo” (herramienta externa, canal, proveedor) cae, redistribuir flujos sin recomputación global.

**Mapeo directo a Kiln**  
- **resilience and fallback**: diseñar pipelines de ejecución como redes adaptativas (no DAG estático), con métricas de costo/robustez y capacidad de re‑ruta rápida. citeturn1search7turn8search28  
- **observability**: el equivalente del “flujo” es telemetría por camino (latencia, errores, costo), que determina refuerzo o poda.  
- **routing**: puede coexistir con estigmergia (rastros) pero enfatizando **tradeoffs explícitos** (eficiencia vs robustez vs costo), lo cual está muy documentado en análisis de redes biológicas. citeturn8search7turn8search28

**Riesgo probable de implementación**  
- Complejidad: si el sistema cambia topología demasiado, se complica reproducibilidad y debugging.  
- Costos: “engruesar” hot paths puede aumentar gasto si no se controla.

**Dónde se rompe la analogía**  
En micelio, el refuerzo es físico (diámetro, biomasa) y las restricciones energéticas son duras; en Kiln, refuerzo suele ser lógico (caching, preferencia). Sin un modelo explícito de costo (dinero/latencia) la analogía pierde el “mecanismo seleccionador” real.

**Priority score para Kiln**: 7/10 (valioso para resiliencia, pero requiere disciplina de control de complejidad).

### Morfogénesis y biología del desarrollo

**Mecanismo biológico probado**  
Dos ideas centrales en formación de patrones: **información posicional** (células interpretan su “posición” según concentraciones de morfógenos) y **reacción‑difusión** (interacciones y difusión generan patrones espaciales). citeturn2search0turn2search32 La señalización por gradientes de morfógenos y su interpretación por umbrales/códigos temporales es un tema activo con principios de precisión/robustez. citeturn2search32turn2search20 Hay también literatura sobre robustez/canalización (buffering de ruido genético/ambiental) y mecanismos de amortiguación (chaperonas, miRNA, redes reguladoras). citeturn2search2turn2search22

**Estado, señales y memoria: respuestas obligatorias**  
Estado: campos espaciales (gradientes), redes reguladoras; destinos celulares como atractores de desarrollo. citeturn2search32turn2search10  
Señales: morfógenos difusibles, inhibidores/activadores, feedback local. citeturn2search0turn2search32  
Qué se refuerza: decisiones de destino estabilizadas por redes reguladoras; patrones auto‑organizados. citeturn2search2turn2search10  
Qué se inhibe: variaciones (ruido) amortiguadas por buffering/canalización. citeturn2search2turn2search22  
Qué se recuerda: el patrón final y la arquitectura resultante; en biología, memoria es estructural. citeturn2search0  
Qué se olvida: fluctuaciones transitorias y estados intermedios no estabilizados. citeturn2search2  
Qué mantiene estabilidad bajo presión: robustez/canalización + redundancia regulatoria. citeturn2search22turn2search10  
Equivalente “limpio” en Kiln: **propagación de configuración/política** con amortiguación de ruido y convergencia a estados válidos.

**Abstracción computacional (no afirmación biológica)**  
1) **Gradientes como “señales de configuración”**: valores continuos (riesgo, presupuesto, urgencia, confidence) que determinan qué políticas/herramientas se activan por umbral.  
2) **Canalización como “convergencia”**: aun con inputs perturbados, el sistema converge a modos seguros (guardrails) y evita bifurcaciones caóticas.

**Mapeo directo a Kiln**  
- Encaje parcial con **context governance** (políticas por umbral), **approvals and trust boundaries** (umbral para aprobación), y **product surfaces** (diferentes superficies reciben diferentes “concentraciones” de contexto/política).  
- Menor encaje con el núcleo de orquestación: la mayor parte de morfogénesis explica patrones espaciales/embriogénesis; su traducción a software es principalmente analogía.

**Riesgo probable de implementación**  
Sobre‑matematizar: construir sistemas de “reacción‑difusión” para routing suele ser baja relación señal/valor a menos que exista un problema de distribución espacial real (p.ej., edge computing). También puede ocultar decisiones políticas bajo parámetros continuos opacos.

**Dónde se rompe la analogía**  
El desarrollo es un proceso físico‑espacial con restricciones de difusión y tiempos biológicos; Kiln es un sistema de eventos discretos en infraestructura digital. La correspondencia es débil salvo en la parte “umbral‑estado estable”.

**Priority score para Kiln**: 5/10 (útil sólo para esquemas de umbrales y robustez conceptual; baja prioridad práctica inicial).

### Biomáquinas, cibernética y sistemas sensor‑actuador

**Mecanismo biológico y formal probado**  
La cibernética nace como estudio de control y comunicación (feedback) en animales y máquinas; el núcleo es lazos de realimentación y mensajes/ruido como parte del sistema. citeturn3search0 La ley de variedad requerida (Ashby) formula que el regulador necesita variedad suficiente para contrarrestar la variedad de perturbaciones (“solo variedad destruye variedad” en regulación activa). citeturn9search1 En estimación de estado bajo ruido, el filtro de Kalman introduce una solución recursiva para filtrado/predicción lineal en tiempo discreto (modelo + actualización). citeturn9search13turn9search25 En control industrial, PID es un esquema clásico de feedback con términos proporcional‑integral‑derivativo; su práctica requiere tuning y tradeoffs (overshoot, sensibilidad a ruido, estabilidad). citeturn3search2turn3search10

**Estado, señales y memoria: respuestas obligatorias**  
Estado: variables internas del sistema (latencia, tasa de fallos, backlog, riesgo, costo), muchas parcialmente observables. citeturn9search25turn3search0  
Señales: mediciones ruidosas; señales de control; errores vs referencia. citeturn3search2turn9search13  
Qué se refuerza: acciones de control que reducen error sostenidamente (con cuidado por oscilación). citeturn3search2  
Qué se inhibe: desviaciones/perturbaciones; excesos de control con límites/anti‑windup (en ingeniería). citeturn3search2turn3search10  
Qué se recuerda: estimaciones y parámetros del controlador (y, si se aprende, el modelo). citeturn9search25turn9search1  
Qué se olvida: ruido mediante filtrado; errores viejos mediante integración limitada/ventanas. citeturn9search25turn3search2  
Qué mantiene estabilidad bajo presión: feedback negativo + estimadores robustos + variedad suficiente en actuadores/políticas. citeturn9search1turn3search0  
Equivalente “limpio” en Kiln: **control plane explícito**: sensores (telemetría) → estimador de estado → controladores → actuadores (router, budgets, policies, fallbacks).

**Abstracción computacional (ya es ingeniería, no “biomimética”)**  
1) **Control loops por vector**: loops separados para latencia, seguridad, costo, calidad.  
2) **Estimador de estado**: Kalman‑like para inferir “estado real” (p.ej., degradación de un proveedor) usando señales ruidosas.  
3) **Variedad requerida**: asegurar que Kiln tenga suficientes acciones disponibles (fallbacks, modos, aprobaciones, degradación) como para regular un entorno con alta variedad (8 canales + múltiples CLIs + multi‑tenant).

**Mapeo directo a Kiln**  
- **observability**: sensores y estimación de estado (Kalman) para distinguir ruido de degradación real. citeturn9search25turn9search13  
- **resilience and fallback**: controladores que eligen degradación/fallback de manera estable (evitar oscilación). citeturn3search10turn3search2  
- **coordination intelligence**: ThresholdAllocator/CascadeController pueden formalizarse como controladores con setpoints multi‑objetivo.  
- **routing**: ley de variedad requerida: si el router sólo puede elegir entre pocas rutas/estrategias, no puede estabilizarse ante variedad de fallos/inputs. citeturn9search1

**Riesgo probable de implementación**  
- **Sobre‑control**: demasiados loops en competencia producen “control wars”.  
- **Model mismatch**: Kalman presupone estructura/modelo; si el sistema es altamente no lineal, el estimador debe adaptarse o simplificarse.

**Dónde se rompe la analogía**  
Aquí casi no hay “analogía”: cibernética/control ya es el lenguaje formal más cercano a sistemas de orquestación. La ruptura real aparece si se pretende que un único modelo lineal capture la totalidad de Kiln.

**Priority score para Kiln**: 10/10 (máxima prioridad por control/observabilidad/resiliencia).

## Software Abstractions

A partir de los mecanismos anteriores, lo más útil para Kiln es un conjunto de **abstracciones operables**, cada una con estado, señales, refuerzo/inhibición, memoria/olvido y un equivalente limpio.

**Plano común: sistema de control multi‑escala (invariante)**  
- Estado mínimo (por tenant, canal, tarea, herramienta): *capacidad*, *riesgo*, *costo*, *calidad*, *confiabilidad*, *backlog*, *confianza* (trust level).  
- Señales: mediciones (telemetría), eventos de ejecución, residuos (predicho‑observado), firmas de riesgo, resultados de evaluación. citeturn5search26turn3search2  
- Refuerzo: ajustes acotados de pesos de enrutamiento/selección basados en señales de éxito y scorers (refuerzo dopaminérgico como guía conceptual, no literal). citeturn5search28  
- Inhibición: frenos explícitos: políticas, checkpoints, límites de tasa, circuit breakers (inmunidad + E/I + control). citeturn4search1turn5search3turn3search2  
- Memoria/olvido: memoria de sesión (rápida), memoria episodica (trazabilidad), memoria semántica (RAG), y olvido operacional (decay/TTL) con retención audit separada. citeturn6search25turn2search3  
- Estabilidad: homeostasis/allostasis como diseño de modos operativos y setpoints adaptativos. citeturn0search7turn1search0

**Abstracción de “routing con trazas” (stigmergia + micelio)**  
- Estado: matriz de preferencia/probabilidad por ruta + trazas ambientales con decaimiento. citeturn10search0turn8search5  
- Señales: latencia/fallo/éxito por ruta; congestión por canal; resultados de seguridad.  
- Refuerzo: aumentar preferencia y “thickening” (caching, prewarm, retries inteligentes) en rutas estables. citeturn8search0  
- Inhibición: evaporación/TTL; caps por tenant; penalización por señales de riesgo. citeturn10search9  
- Memoria: entorno como memoria externalizada (rastros). citeturn10search11  
- Olvido: evaporación. citeturn10search9  
- Estabilidad: explorar con presupuesto para evitar lock‑in; hysteresis para evitar oscilación.

**Abstracción de “seguridad en capas” (innata/adaptativa/checkpoints)**  
- Estado: políticas por tenant, reputación, contexto y permisos; base de firmas y modelos. citeturn1search1turn4search1  
- Señales: detectores PRR (rápidos), scorers, monitoreo de tool calls, anomalías. citeturn1search1turn4search17  
- Refuerzo: selección/afinamiento offline (centro germinal) de reglas/políticas con suites de eval. citeturn0search10turn0search6  
- Inhibición: PD‑1/CTLA‑4 como plantilla para “frenos” (aprobación humana, aislamiento, reducción de permisos). citeturn4search1  
- Memoria/olvido: memoria de incidentes + resolución (bajar alertas cuando el evento pasó). citeturn4search27  
- Estabilidad: evitar auto‑inmunidad (falsos positivos) con calibración y observabilidad.

**Abstracción de “memoria multi‑nivel con consolidación”**  
- Estado: working set + índice episódico + base semántica. citeturn6search25turn0search13  
- Señales: accesos, reactivaciones, relevancia, saliencia, feedback. citeturn6search0turn5search28  
- Refuerzo: aumentar índices/embeddings/resúmenes si recurren y aportan valor.  
- Inhibición: limitar interferencia (no todo entra a contexto). citeturn0search1  
- Olvido: renormalización/decay controlado (analogía informada por SHY, con debate). citeturn2search3turn9search26  
- Estabilidad: separación de almacenes; políticas de retención.

## Direct Kiln Mappings

### Stack biológico rankeado para Kiln

El “stack” se ordena por **impacto directo sobre invariantes de arquitectura** (control, seguridad, memoria, enrutamiento) y por madurez de formalización:

1) **Cibernética y control sensor‑actuador** (10/10): base formal para observabilidad, control loops, y ley de variedad requerida. citeturn3search0turn9search1turn9search13  
2) **Homeostasis / allostasis** (10/10): plantilla directa para modos operativos, setpoints adaptativos y estabilidad bajo carga. citeturn0search7turn1search0  
3) **Sistemas de memoria (neurociencia cognitiva)** (10/10): arquitectura de memoria multi‑escala y continuidad de sesión. citeturn6search25turn0search13  
4) **Sistema inmune** (9/10): safety pipeline en capas, trust boundaries, inhibición/checkpoints y “aprendizaje defensivo” offline. citeturn1search1turn4search1turn0search10  
5) **Enjambre/estigmergia** (8/10): routing distribuido con trazas y decaimiento; aplicable a multi‑canal y meta‑orquestación. citeturn10search0turn10search11  
6) **Sistema nervioso (micro‑mecanismos de plasticidad y error)** (8/10): útil para reglas de actualización y gobernanza de deltas; riesgo si se implementa como aprendizaje online no acotado. citeturn0search4turn5search26turn5search28  
7) **Redes fúngicas/micelio** (7/10): resiliencia y topología adaptativa (hot paths/loops redundantes) con tradeoffs multi‑criterio. citeturn8search5turn1search7turn8search28  
8) **Morfogénesis/desarrollo** (5/10): aplicable casi sólo a umbrales/robustez; baja prioridad para motor de orquestación. citeturn2search0turn2search22

### Mapa de arquitectura biológica para Kiln

El objetivo es traducir dominios a **módulos internos** (no “temas inspiracionales”) alineados con los vectores de Kiln.

```text
                           ┌─────────────────────────────────────────┐
                           │               CONTROL PLANE              │
                           │  (Cybernetics + Homeostasis/Allostasis)  │
                           │  - state estimator (Kalman-like)          │
                           │  - controllers (latency, cost, risk)      │
                           │  - mode manager (normal/degraded/etc.)    │
                           └───────────────┬──────────────────────────┘
                                           │ control signals
                                           v
┌─────────────────────────────┐      ┌───────────────────────────────┐
│         SENSORS             │      │            ACTUATORS            │
│ observability + telemetry   │      │ routing + tool execution        │
│ - channel metrics           │      │ - router between adapters       │
│ - tool failures/latency     │      │ - fallback between CLIs         │
│ - safety signals            │      │ - concurrency/timeouts          │
└──────────────┬──────────────┘      └──────────────┬────────────────┘
               │                                     │
               v                                     v
      ┌─────────────────┐                  ┌────────────────────────┐
      │ SAFETY PIPELINE  │                  │ ROUTING & COORDINATION  │
      │ (Immune system)  │                  │ (Swarm + Nervous)       │
      │ - PRR detectors  │                  │ - stigmergic traces      │
      │ - checkpoints    │                  │ - gating/selection       │
      │ - approvals      │                  │ - team/task allocation   │
      └────────┬────────┘                  └──────────┬──────────────┘
               │                                     │
               v                                     v
      ┌──────────────────────────────────────────────────────────────┐
      │                         MEMORY LAYER                          │
      │ (Cognitive memory systems)                                     │
      │ - working session state                                        │
      │ - episodic logs (append-only)                                  │
      │ - semantic RAG store                                            │
      │ - consolidation + forgetting policies                           │
      └──────────────────────────────────────────────────────────────┘
```

### Dominio → vectores de Kiln con mapeos concretos

En lugar de “mapear todo a todo”, estos son los encajes más fuertes (donde el mecanismo puede transformarse en invariante):

- **orchestration**: cibernética (control loops) + homeostasis (modos) + gating de acción (sistema nervioso). citeturn3search0turn0search7turn5search1  
- **routing**: estigmergia/AntNet + predictive coding (residuos) + variety required (capacidad del router). citeturn10search0turn5search26turn9search1  
- **coordination intelligence**: enjambre (asignación distribuida), homeostasis (presupuestos), basal‑ganglia‑style gating (selección). citeturn10search0turn0search7turn5search25  
- **memory**: indexación hipocampal → índice episódico; consolidación → pipeline de resúmenes/embeddings; “renormalización” → compactación. citeturn6search25turn0search13turn2search3  
- **context governance**: predictive coding (propagar deltas) + memoria de trabajo vs largo plazo + checkpoints inmunes. citeturn5search26turn6search0turn4search1  
- **safety and security**: PRR + centros germinales (selección defensiva) + control de cascadas (factor H) + resolución. citeturn1search1turn0search10turn4search2turn4search27  
- **tool execution**: sensor‑actuador (control) + gating + inhibición/approval; diseño explícito de actuadores. citeturn3search2turn4search1turn5search1  
- **approvals and trust boundaries**: checkpoints (PD‑1/CTLA‑4) + tolerancia central como plantilla de “deny by default/allow by proven safe”. citeturn4search1turn4search20  
- **continuity and session state**: memoria de trabajo + índice episódico + consolidación. citeturn6search0turn6search25turn0search13  
- **observability**: cibernética + estimación de estado (Kalman). citeturn3search0turn9search13  
- **resilience and fallback**: homeostasis/allostasis + redes adaptativas (micelio) + rutas estigmergicas con decaimiento. citeturn0search7turn8search5turn10search0  
- **product surfaces: TUI, SDK, Studio, widget**: aquí el mapeo biológico es limitado; lo útil es tratarlas como **interfaces de sensores/actuadores** con distintos niveles de permiso y latencia (más ingeniería que biología). citeturn3search0  
  - Contexto operativo: si el ecosistema incluye enrutamiento hacia orquestadores externos de entity["company","Anthropic","ai company, san francisco"] y entity["company","OpenAI","ai company, san francisco"], el control plane debe tratar “proveedor externo” como actuador con incertidumbre y fallos (estimación + fallback), no como dependencia fija. citeturn9search25turn3search10

## Risks / Misuse

**Aprendizaje online sin inhibición suficiente**  
Reglas tipo STDP / refuerzo en vivo pueden amplificar sesgos y crear colapsos de diversidad de rutas (“mono‑ruta”), especialmente en routing multi‑tenant. El control biológico de plasticidad está altamente regulado; Kiln necesita límites explícitos: máximo delta por ventana, exploración obligatoria, y rollback. citeturn0search4turn5search28turn3search2

**Cascadas de seguridad y auto‑inmunidad**  
La analogía inmune es potente pero peligrosa: un PRR demasiado sensible genera “inflamación crónica” (bloqueos constantes) y degrada el producto. Biológicamente existen checkpoints y resolución; en Kiln deben existir equivalentes: *cooldowns*, *graduated responses*, y pruebas de calibración. citeturn4search1turn4search27

**Oscilación de control (thrashing)**  
Control loops sin hysteresis o con señales ruidosas pueden oscilar entre modos o fallbacks (p.ej., alternar entre orquestadores externos o entre canales). Control clásico discute sensibilidad a ruido y necesidad de tuning; en Kiln esto exige: filtros, ventanas, y límites de conmutación. citeturn3search2turn3search10turn9search25

**Enrutamiento estigmergico vulnerable a manipulación**  
Los rastros (traces) son un objetivo: un atacante puede forzar patrones que “alimenten” al router con evidencia falsa (poisoning). Hay que firmar/aislar señales, segmentar por tenant y usar validación cruzada (observability + scorers) antes de reforzar. citeturn10search0turn10search11

**Complejidad topológica y pérdida de reproducibilidad**  
El enfoque “micelio” (topología adaptativa) puede degradar debug si la ruta cambia constantemente. Requiere: versionado de rutas/políticas y un modo “freeze for incident” para reproducir. citeturn8search5turn1search7

## Where The Analogy Breaks

**Sistema nervioso**  
- Ruptura: spikes y sinapsis son hardware con restricciones biofísicas; en software, los eventos no tienen la misma semántica de “temporización causal” salvo que la diseñes (timestamps, ventanas, orden parcial). STDP aplicado a orquestación es analogía, no equivalencia. citeturn0search4turn0search0

**Memoria**  
- Ruptura: el cerebro no ofrece auditoría append‑only ni consistencia transaccional; Kiln sí debe hacerlo (especialmente multi‑tenant). Por eso la memoria debe separarse en *recall operativo* vs *retención*.

**Sistema inmune**  
- Ruptura: en biología, “self” es un constructo emergente e imperfecto; en Kiln, “self” es principalmente tenant/política/identidad. Usar un mapeo literal puede llevar a modelos erróneos de confianza. citeturn4search28turn4search4

**Homeostasis/allostasis**  
- Ruptura: los setpoints biológicos están acoplados a fisiología con límites duros; en software, límites son económicos y de SLA, y pueden cambiar por producto/negocio. La parte útil es formalizar setpoints y costos como primeros ciudadanos. citeturn0search7turn1search0

**Swarm/estigmergia**  
- Ruptura: el entorno físico evapora “gratis”; el entorno digital acumula si no se diseña decaimiento y limpieza. Sin evaporación, no hay estigmergia funcional. citeturn10search11turn10search9

**Micelio**  
- Ruptura: la resiliencia emerge de redundancia física y crecimiento continuo; en software, redundancia cuesta dinero y complejidad, y no existe crecimiento “gratis”. Debe modelarse como optimización multi‑criterio explícita (costo/robustez/latencia). citeturn1search7turn8search28

**Morfogénesis**  
- Ruptura: muchos mecanismos dependen de espacialidad continua (difusión) y desarrollo irreversible; Kiln opera en eventos discretos reversibles. El valor práctico está en umbrales/estabilidad, no en simular reacción‑difusión.

## Actionable Research Follow-Ups

### Qué estudiar primero

**Control plane y cibernética aplicada a orquestación**  
1) Formalizar “estado” de Kiln: definir un vector de estado mínimo por tenant/canal/herramienta y la ecuación de observación (qué métricas lo aproximan). (Kalman/estimación recursiva como guía; no requiere linealidad estricta para ser útil como estructura mental.) citeturn9search13turn9search25  
2) Diseñar controladores por objetivo (latencia, costo, seguridad): empezar con controladores simples y estables (PI/PID con hysteresis) y luego evolucionar. citeturn3search2turn3search10  
3) Aplicar “variedad requerida”: enumerar perturbaciones (fallo de proveedor, congestión de canal, ataques, límites de cuota, herramientas lentas) y asegurar que existan actuadores suficientes (fallbacks, degradación, approvals, límites). citeturn9search1

**Seguridad en capas con inhibición y resolución**  
1) Construir una taxonomía de “PRRs” para entradas y planes: detectores rápidos y baratos que operen sobre *grafos de acciones* además de texto (p.ej., tool-chain patterns). citeturn1search1turn1search13  
2) Modelar checkpoints: reglas explícitas tipo “PD‑1/CTLA‑4” → “reduce permisos / exige aprobación / limita expansión de plan” para reducir daño por sobre‑actividad. citeturn4search1turn4search17  
3) Implementar “resolución”: mecanismos para desactivar estado de contención cuando el incidente termina (cooldowns, evidencia de recuperación), evitando inflamación crónica. citeturn4search27

**Memoria multi‑nivel y consolidación**  
1) Definir un “índice episódico”: qué constituye un episodio (sesión, tarea, sub‑tarea, plan), cómo se rehidrata y qué garantías tiene. citeturn6search25turn6search1  
2) Separar olvido operacional vs retención audit: “olvidar” puede significar bajar ranking y no traer a contexto, sin borrar evidencia.  
3) Diseñar consolidación periódica: resúmenes, deduplicación, re‑indexación con calidad medida; inspirarse en SHY sólo como recordatorio de que el sistema necesita renormalizar, no como mandato de “reset global”. citeturn2search3turn9search26

**Routing distribuido con trazas estigmergicas**  
1) Implementar un “pheromone store” por tenant y por clase de tarea con TTL/decay y protección contra poisoning.  
2) Probar AntNet‑style: agentes/sondas que exploran rutas (hacia herramientas, orquestadores externos, adaptadores de canal) y actualizan probabilidades de enrutamiento con métricas reales. citeturn10search0  
3) Integrar con control plane: el enrutamiento no debe ser “voto popular” por rastros; debe estar regulado por seguridad y costos (homeostasis/allostasis).

### Recomendaciones concretas de prototipos

1) **Router con señal de error (predictive coding operationalizado)**: para cada decisión, registrar predicción de latencia/costo/calidad y luego residual observado; usar el residual como “señal de corrección” para ajustar modelos y pesos de enrutamiento (con límites). citeturn5search26turn9search25  
2) **Modo alostático por canal**: setpoints distintos por canal (p.ej., chat vs email) y por tenant; cuando la carga acumulada (allostatic load) sube, activar ruta más conservadora (más approvals, menos herramientas externas). citeturn0search7turn0search3  
3) **Centro germinal offline para seguridad**: generar variantes de políticas/heurísticas y seleccionarlas por suites adversariales y scorers; desplegar sólo cambios que pasen umbrales y con rollback. citeturn0search10turn0search6  
4) **Hot‑path thickening micelial**: detectar cadenas de tool execution recurrentes y confiables; reforzarlas con caching/pre‑warm/instrumentación adicional; podar rutas frágiles. citeturn8search5turn8search28

### Do not study yet

**Active inference / free energy principle como arquitectura global**  
Es conceptualmente atractivo pero de alta complejidad matemática y con riesgo de “teoría‑primero”. Para Kiln, predictive coding y control por error ya aportan el 80% del valor práctico sin comprometerse con un marco totalizador. citeturn6search15turn5search26

**Simulación de reacción‑difusión o morfogénesis para routing**  
Baja relación esfuerzo/beneficio salvo que Kiln se despliegue sobre topologías físicas (edge con constraints espaciales). La utilidad inmediata está en umbrales y robustez, no en PDEs.

**Microdetalles neuroanatómicos (columnas, capas, tipos neuronales específicos)**  
A menos que vayan a implementarse modelos neuromórficos específicos, el retorno marginal es bajo frente a control loops, memoria y seguridad en capas.

**“Micelio” como sistema dinámico libre sin versionado**  
Estudiar micelio es útil, pero no conviene priorizar diseños de topología altamente variable antes de tener: (i) observabilidad madura, (ii) control plane estable, (iii) trazabilidad reproducible de ejecuciones. citeturn8search5turn3search0