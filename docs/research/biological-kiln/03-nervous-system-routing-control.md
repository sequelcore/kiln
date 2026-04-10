# Sistema nervioso como arquitectura de enrutamiento y control para Kiln

## Mechanisms

Los sistemas nerviosos biológicos resuelven, de manera verificable, problemas que en Kiln aparecen como: “decidir rápido vs decidir bien”, “gobernar acciones con efectos secundarios”, “detectar eventos relevantes”, “resolver conflictos entre acciones competidoras” y “coordinar circuitos locales con un control global”. A continuación se separan mecanismos biológicos **probados** (no analogías sueltas) que soportan esas funciones.

La arquitectura de **arcos reflejos** es el ejemplo canónico de “respuesta rápida con computación mínima”. En el **reflejo de estiramiento** (miotático), el circuito local en la médula espinal incluye: receptor (huso muscular) → aferente Ia → sinapsis excitatoria monosimpática sobre motoneuronas α del músculo homónimo, y en paralelo interneuronas que median **inhibición recíproca** sobre antagonistas (relajación del músculo opuesto). Este diseño usa aferentes Ia de gran diámetro para baja latencia, y produce una corrección rápida del estado mecánico. El mismo capítulo lo formula explícitamente como un **lazo de retroalimentación negativa** para mantener la longitud muscular alrededor de un “setpoint” influido por vías descendentes. citeturn4view0

El arco reflejo también existe en variantes más complejas como el **reflejo flexor o de retirada** (withdrawal), que es **polisináptico** y recluta interneuronas para coordinar múltiples articulaciones, retirando una extremidad ante estímulos nocivos; su rol protector y su generación principalmente espinal son consistentes en revisiones clínicas y de neuroanatomía. citeturn0search0turn0search12turn0search32

La distinción “**procesamiento central vs periférico**” no es un eslogan: hay evidencia experimental de que circuitos “periféricos” (en el sentido de que no requieren corteza) pueden generar patrones motores complejos. En locomoción, la **médula espinal** contiene circuitos oscilatorios llamados **generadores centrales de patrones (CPGs)**. En gatos con transección torácica, las patas traseras aún pueden producir movimientos locomotores coordinados con soporte y cinta, y parte del patrón persiste aun cortando raíces dorsales (se atenúa, pero no desaparece), lo que muestra que el ritmo básico no depende exclusivamente de input sensorial ni de control descendente. El mismo texto enfatiza que, en humanos, los movimientos generados solo por médula tras daño descendente son menos efectivos, sugiriendo mayor dependencia de vías superiores. citeturn4view1turn2search24

La **inhibición** en biología es un mecanismo de control (no un detalle de implementación). Aparece en tres niveles útiles para Kiln:

1) **Inhibición espinal postsináptica y control del flujo sensorial**. En asta dorsal, GABA y glicina regulan excitabilidad, afectando cuánto “pasa” hacia neuronas de proyección. Revisiones neurofisiológicas enfatizan que la inhibición (GABAérgica y glicinérgica) es central para “gating” de información somatosensorial. citeturn8search25

2) **Inhibición recurrente (Renshaw)** como freno local de estabilidad. Las células de Renshaw reciben colaterales de motoneuronas y devuelven inhibición sobre esas motoneuronas (y otros blancos), estabilizando la salida. Trabajo fisiológico directo destaca que la inhibición recurrente puede ser muy eficaz (p. ej., efectos fuertes con actividad mínima del interneurón). citeturn8search1turn8search20

3) **Inhibición presináptica** como control del “ancho de banda” de entrada. Un mecanismo clave es la sinapsis axo-axónica GABAérgica sobre terminales aferentes, que reduce la liberación de neurotransmisor y por lo tanto la eficacia sináptica del input sensorial. Revisiones clásicas describen este control como una forma potente de modular selectivamente la efectividad de fibras sensoriales en la médula. citeturn8search2turn2search2

La **detección de saliencia** y el “cambio de modo” (de reposo a control ejecutivo) no es solo psicológico: está soportado por redes y dinámicas medibles. Un resultado influyente de conectividad intrínseca identifica una **red de saliencia** anclada en **dorsal anterior cingulate (dACC)** y **frontoinsular cortex** (incluida la ínsula anterior), con conectividad hacia estructuras subcorticales/ límbicas, separable de una red de **control ejecutivo** más dorsolateral frontoparietal. Este trabajo además interpreta que la red de saliencia se asocia a identificar lo más relevante entre muchos estímulos (internos/externos), integrando marcadores viscerales/autonómicos con información sensorial procesada. citeturn20view0turn21view1

Más allá de una “lista de regiones”, hay evidencia causal de **switching**: un estudio con fMRI, cronometraje y análisis de causalidad (Granger) reporta un rol crítico de la red **right fronto-insular cortex (rFIC)** + ACC en el cambio entre **central-executive network (CEN)** y **default-mode network (DMN)**, con replicación en tareas distintas y reposo. citeturn16view0

A nivel de dinámica de red, análisis con fMRI de alta resolución temporal muestran que la red de saliencia presenta alta **flexibilidad temporal** en su conectividad con otras redes, y mantiene alta **centralidad** como hub, lo que es coherente con una función de “interacción cruzada” entre sistemas. citeturn7view1

Los sistemas nerviosos también necesitan un mecanismo para **selección de acciones competidoras**. En vertebrados, una hipótesis robusta sitúa a los **ganglios basales** como un dispositivo de selección que resuelve conflictos “ganador-perdedor” mediante un principio combinado: **inhibición amplia** de programas competidores y **desinhibición focal** del programa deseado. citeturn1search0turn1search1  
En términos de circuitería, modelos y revisiones de basal ganglia describen rutas directas/indirectas/hiperdirectas y un patrón en el que núcleos de salida (p. ej., GPi/SNr) ejercen inhibición tónica sobre el tálamo; la selección se implementa modulando esa inhibición a través de rutas que convergen en los núcleos de salida. citeturn9view2

Finalmente, la coordinación entre **circuitos locales** y **coordinación global** aparece con fuerza en el tálamo. Una revisión propone un marco donde el tálamo recibe control inhibitorio de dos grandes sistemas: el **thalamic reticular nucleus (TRN)** y entradas **extra-talámicas inhibitorias**; el TRN puede operar a distintas escalas espaciotemporales (inhibición más local durante selección atencional y más global durante sueño), permitiendo ajustar la salida tálamo-cortical a “demandas conductuales” en curso. citeturn11view0turn11view2

Un fenómeno útil para “gating” sensoriomotor es la **prepulse inhibition (PPI)**: un estímulo débil, presentado antes de uno fuerte, reduce la respuesta de sobresalto; trabajo en roedores reporta que neuronas PV+ en TRN se activan con el paradigma de PPI y que inhibirlas deteriora PPI, sugiriendo participación causal del circuito TRN–tálamo auditivo en este filtro temprano. citeturn19view2

image_group{"layout":"carousel","aspect_ratio":"16:9","query":["spinal reflex arc diagram stretch reflex Ia afferent motoneuron","withdrawal reflex polysynaptic diagram spinal cord","basal ganglia direct indirect hyperdirect pathway diagram","salience network anterior insula dorsal anterior cingulate diagram"],"num_per_query":1}

## Software Abstractions

Esta sección toma los mecanismos anteriores y los abstrae como **patrones de control** aplicables a un runtime de orquestación. La abstracción se mantiene separada de mapeos a módulos de Kiln.

Un **arco reflejo** se abstrae como un *control loop local de baja latencia* con tres rasgos: (a) **camino corto** de decisión, (b) **resolución local** sin dependencia obligatoria del “centro”, y (c) posibilidad de **modulación descendente** (cambio de setpoints/políticas) sin reescribir el circuito. La retroalimentación negativa del reflejo de estiramiento (setpoint + corrección) sugiere un patrón de “política + sensor + actuador” donde el sensor mide desviación y el actuador corrige con mínima deliberación. citeturn4view0

La evidencia de **CPGs espinales** motiva una abstracción de *máquinas de estado / generadores de secuencia* que conservan dinámica interna aun cuando el input sea parcial. En software: una estrategia puede mantener un “ritmo” (secuencia de pasos) y adaptarse a señales externas, pero sin requerir supervisión continua. El dato clave que sostiene esta abstracción es la autonomía parcial de patrones locomotores respecto de entrada sensorial y control descendente. citeturn4view1

La **inhibición** se abstrae como *gating explícito* en tres modalidades:
- *Inhibición postsináptica* ⇒ reducir la probabilidad de que un evento active una acción (umbral / “deny-by-default” local). citeturn8search25  
- *Inhibición recurrente* ⇒ un freno de estabilidad que limita amplificación y oscilación (feedback negativo que evita runaway). citeturn8search1  
- *Inhibición presináptica* ⇒ control del ancho de banda/ prioridad de entrada: no cambia la acción directamente, cambia cuánta señal llega al decisor (“throttle” sobre inputs). citeturn8search2

La **detección de saliencia** se abstrae como *clasificación temprana + reasignación de recursos*. En biología, la red de saliencia se ancla en hubs específicos y participa en switching entre redes (CEN ↔ DMN). En software, esto equivale a un componente que observa señales (internas/externas), estima “importancia” y cambia el modo de cómputo: pasar de pipeline barato a pipeline caro; o de “automático” a “supervisado”. La base empírica es la separación entre redes de saliencia y control ejecutivo, y la evidencia de switching causal desde frontoinsular/ACC hacia otras redes. citeturn20view0turn16view0turn7view1

La **selección de acciones competidoras** se abstrae como *arbitraje por desinhibición focal*: no es “activar” directamente la acción, sino **quitar** un freno para una acción mientras se mantiene el freno para las demás. Esta abstracción evita un anti-patrón típico en software (suma de “habilitadores” que disparan múltiples acciones a la vez) y favorece un modelo de “una acción gana; las otras quedan inhibidas”. En biología esto se apoya en hipótesis y circuitería de ganglios basales para selección/inhibición de programas competidores. citeturn1search0turn9view2

La coordinación **local vs global** se abstrae como un *sistema jerárquico con múltiples escalas de control*. El TRN y otras fuentes inhibitorias del tálamo sugieren un patrón de “router intermedio” que regula tráfico hacia un procesador más caro (corteza), con control top-down y bottom-up, y con la capacidad de cambiar granularidad (local vs global) según estado (p. ej., atención vs sueño). La regla abstracta: “no todo trámite merece entrar al core; existe un gate intermedio con políticas por estado”. citeturn11view0turn11view2turn19view2

## Direct Kiln Mappings

Esta sección mapea las abstracciones anteriores a módulos concretos del contexto Kiln que diste (ModelRouter/RulesRouter/AgentRAG, ModeBOrchestrator, DevToolExecutionBridge, SessionRegistry con circuit breaker, rails de seguridad, EventBus, gateway multi-tenant, etc.). Aquí el objetivo no es “parecerse a un cerebro”, sino **derivar invariantes y rutas de control** que reduzcan latencia, aumenten seguridad y mejoren resiliencia.

### Mapeo de mecanismos a superficies de runtime

**Fast path vs slow path**
- **Fast path** (reflejo): evaluaciones deterministas y baratas que deben poder ejecutar **sin invocar LLM** y sin bloquear el scheduler (p. ej., PII scanner, content classifier, reglas Tier 1) para decidir *permitir, bloquear, degradar, o requerir aprobación*. Este mapeo es coherente con arcos reflejos (camino corto) y con inhibición presináptica (filtrar entrada antes de procesamiento). citeturn4view0turn8search2  
- **Slow path** (corteza/selección deliberativa): rutas que requieren más cómputo/IO o incertidumbre: AgentRAG (Tier 2), complejidad (5 señales), consulta a capability registry de modelos, supervisor/swarm; y cualquier “escalación” que implique herramientas con efectos secundarios o decisiones de alto impacto.

**Routing decisions**
- **ModelRouter + RulesRouter (Tier 1)**: ubícalos como el “arbitraje de baja latencia” para la mayoría de enrutamientos repetibles, con prioridad ordenada (equivalente a un circuito entrenado/políticas descendentes).  
- **AgentRAG (Tier 2)**: úsalo como un mecanismo de “reconocimiento contextual” cuando Tier 1 no resuelve, similar a cambiar de modo por saliencia: la decisión deja de ser puramente sintáctica y pasa a ser semántica (embedding retrieval). La evidencia biológica que motiva el “switch” (no el RAG mismo) es que hubs de saliencia disparan reconfiguración hacia redes ejecutivas. citeturn16view0turn7view1

**Escalation**
- Modela la escalación como “**desinhibición focal**”: por defecto, muchas capacidades deben estar inhibidas (p. ej., herramientas privilegiadas, acciones de alto riesgo), y solo se desinhiben cuando: (a) el riesgo es aceptable y (b) hay señal suficiente (contexto, autorización, presupuesto). Esto se alinea con la idea de que selección no “activa todo”, sino que permite una cosa y mantiene inhibidas competidoras. citeturn1search0turn9view2

**Fallback**
- Interprétalo como redundancia jerárquica: si el fast path no resuelve, se pasa al slow path; si un modelo falla, se usa fallback; si una herramienta falla, retry/fallback. El punto biológico útil no es “redundancia porque sí”, sino que muchos circuitos preservan función bajo fallos parciales (CPGs y reflejos continúan bajo inputs degradados). citeturn4view1

**Safety interrupts**
- Deben ser verdaderas **interrupciones no enmascarables** (NMI) a nivel runtime: si una rail de política o PII detecta una condición bloqueante, el sistema debe poder abortar generación/herramienta y producir un estado terminal seguro. El fundamento conceptual es el rol de inhibición (bloquear propagación) y de gating sensoriomotor (PPI como filtro temprano). citeturn8search25turn19view2

**Tool invocation gating**
- DevToolExecutionBridge (deny vs approval-required) + ModeBOrchestrator son el lugar natural para modelar “inhibición” y “desinhibición” de acciones con efectos secundarios. La literatura de control inhibitorio fronto-subcortical muestra un patrón donde la corteza prefrontal modula conectividad hacia núcleos subcorticales para amplificar inhibición aguas abajo; en términos de arquitectura, esto favorece un diseño donde el “modulador” (orquestador) **no ejecuta** herramientas, pero **modula** si el camino a ejecución se abre o se cierra. citeturn24view0turn24view1

### Runtime invariants recomendados

Estas invariantes son propuestas “tipo contrato” para que el runtime de Kiln se mantenga seguro y controlable bajo carga, fallos, y comportamientos emergentes (p. ej., swarm/supervisor). No son metáforas: son condiciones verificables vía test + observabilidad.

**Invariantes de gating y seguridad**
- *No bypass*: toda salida del modelo y toda ejecución de herramienta debe pasar por (a) rails de seguridad relevantes y (b) el gate de herramientas (deny/approval). Ningún strategy (sequential/supervisor/swarm) puede invocar herramientas por un camino alterno.  
- *Monotonía de estado seguro*: una vez que una condición se clasifica como “bloqueante” (PII/política/prompt-injection), solo puede degradarse a “permitido” con una transición explícita y auditable (p. ej., aprobación humana o cambio de política versionado).  
- *Separación de dominios*: el gate de herramientas debe operar con identidad/tenant y presupuesto como inputs obligatorios (multi-tenant gateway + budget middleware), y debe fallar cerrado (“deny by default”).

**Invariantes de selección y competencia**
- *Arbitraje único*: en cada punto de decisión “accionable” (p. ej., elegir una herramienta concreta, elegir un modelo, ejecutar un step que cambia estado), debe existir exactamente un ganador; los demás candidatos quedan explícitamente “inhibidos” con una razón auditable. Esto evita condiciones donde dos agentes disparan acciones incompatibles. La motivación viene de modelos de selección por inhibición/desinhibición (ganglios basales), pero aquí se concreta como una propiedad del grafo de ejecución. citeturn1search0turn9view2  
- *Preservación de causalidad*: un evento o señal que dispara escalación (salience) debe quedar registrado antes del cambio de modo, para que pueda reconstruirse el porqué (similar a exigir un “rastro causal” cuando un hub dispara switching). citeturn7view1turn16view0

**Invariantes de continuidad y reanudación**
- *Checkpoint completo de gates*: cualquier checkpoint/resume debe incluir el estado del gate (aprobaciones pendientes, denegaciones, presupuesto, política activa, clasificación de riesgo). Reanudar sin ese estado equivale a “reanudar con frenos desconectados”.  
- *Idempotencia de efectos externos*: tool calls con efectos secundarios deben ser idempotentes o estar envueltos en un protocolo de deduplicación; el scheduler debe tratar reintentos como potenciales duplicados.

**Invariantes de resiliencia**
- *Fallback acotado*: retries/fallback deben estar acotados por contador, tiempo y presupuesto; y cada fallback debe reducir (no aumentar) el riesgo permitido (p. ej., nunca saltar de “approval-required” a “auto”).  
- *Circuit breaker no reentrante*: SessionRegistry con circuit breaker debe evitar “thrashing” (abrir/cerrar repetidamente); idealmente con ventanas temporales, y con eventos que permitan diagnósticos post-mortem.

**Invariantes de observabilidad**
- *EventBus como fuente de verdad de auditoría*: toda transición relevante (decisión de router, escalación de modo, gate de herramienta, abort por safety interrupt, fallback) debe emitir un evento tipado. Esto permite inspección de “circuito” y reconstrucción de secuencias, análogo a instrumentar reflejos/CPGs con señales medibles. citeturn4view0turn4view1

## Risks / Misuse

Esta sección enumera riesgos técnicos y **anti‑patrones**, con foco en cómo una analogía mal aplicada puede empeorar Kiln.

Un anti‑patrón frecuente es implementar “salience detection” como un **único juicio LLM** que decide todo (modelo, tools, políticas, fallback). Biológicamente, la detección de saliencia y el switching están repartidos en hubs/redes y se apoyan en señales robustas y repetibles; en software, delegarlo a un paso grande, no determinista, y difícil de auditar tiende a destruir el fast path y debilitar la explicabilidad. La evidencia de switching causal de rFIC/ACC hacia otras redes sugiere que el *mecanismo de switching* debe ser observable y con señales tempranas, no una caja negra. citeturn16view0turn7view1

Otro anti‑patrón: “inhibición” implementada como *post‑hoc sanitization* (limpiar el resultado al final) en lugar de *gating previo* para acciones con efectos secundarios. En biología, mucha inhibición existe para evitar que señales inapropiadas se propaguen (p. ej., inhibición presináptica modulando la entrada). En Kiln, si una herramienta peligrosa se ejecuta y luego se intenta “arreglar”, ya ocurrió el efecto. citeturn8search2turn19view2

Riesgo crítico en arquitecturas con swarm/supervisor: **competencia no arbitrada**. La lección utilizable de ganglios basales no es “hacer un módulo BG”, sino que la selección efectiva requiere inhibir competidores y abrir solo un canal de acción. Si Kiln permite que múltiples agentes/estrategias ejecuten herramientas simultáneamente sin una capa única de arbitraje, aparecerán: carreras, duplicación de side effects, y estados imposibles de reanudar. citeturn1search0turn9view2

Riesgo de “reflexos” demasiado agresivos: el fast path puede volverse un **generador de falsos positivos** que bloquea productividad (p. ej., un clasificador de riesgo que dispara safety interrupt con baja precisión). Biológicamente, reflejos y gates (como PPI) tienen ventanas temporales y suelen ser modulables; trasladado a runtime, esto sugiere: thresholds adaptativos por tenant, métricas de precisión/recall, y mecanismos de override explícitos (aprobación). citeturn19view2turn4view0

Riesgo de sobre‑ingeniería: la biología usa múltiples sistemas inhibitorios (TRN + extra-talámico; presináptico + postsináptico), pero en software cada capa extra aumenta: latencia, costos cognitivos de mantenimiento, y superficie de configuración. Un peligro real es añadir “capas biológicas” sin que produzcan invariantes verificables o mejoras en SLA, seguridad o resiliencia. citeturn11view0turn11view2

## Where The Analogy Breaks

Las siguientes rupturas no son filosóficas: importan porque señalan dónde una “inspiración biológica” puede producir decisiones erróneas en Kiln.

El sistema nervioso opera con **paralelismo masivo, dinámica continua y ruido**; Kiln opera con decisiones discretas, componentes versionados y requisitos de reproducibilidad. La biología tolera variabilidad; un orquestador suele necesitar *determinismo operativo* (o al menos reproducibilidad explicable) para auditoría, soporte y cumplimiento.

En biología, “saliencia” y “valor” están acoplados a homeostasis, motivación y estados internos (arousal), y se aprenden en escalas largas. En Kiln, la “saliencia” útil suele ser: riesgo, costo, latencia, incertidumbre y valor de información, con políticas definidas por producto/compliance. Es decir: el concepto “salience detection” sí se traslada como *priorización y switching*, pero **no** como el contenido semántico de lo que el cerebro considera relevante. citeturn20view0turn18search21

La inhibición biológica es rica: cambia ganancia, sincronía, timing, plasticidad y excitabilidad. En Kiln, “inhibición” se reduce a gates de autorización, control de flujo, y cancelación/aborto. Forzar una correspondencia 1:1 llevaría a un diseño innecesariamente complejo; lo correcto es mapear solo los *roles funcionales* (gating, estabilidad, priorización). citeturn11view0turn8search2

Los reflejos muestran autonomía local, pero el cuerpo tiene un “mundo físico” que impone límites y provee retroalimentación inmediata. Kiln actúa sobre sistemas externos (APIs, repos, infraestructura) donde la retroalimentación puede ser tardía o ambigua; por ello, un “fast path” de abortos debe diseñarse con cuidado para no cortar flujos legítimos por señales incompletas.

## Actionable Research Follow-Ups

Diseño de investigación aplicada para convertir los mecanismos anteriores en mejoras verificables de Kiln (no solo documentos).

Validar un **diseño de doble vía (fast/slow)** con métricas duras: (a) latencia p50/p95/p99 por clase de request, (b) tasa de escalación a slow path, (c) tasa de falsos positivos/negativos en safety interrupts, y (d) costo por sesión. La hipótesis a probar es que un fast path tipo “reflejo” reduce sustancialmente p95 sin degradar seguridad. citeturn4view0

Construir un **experimento de switching controlado** inspirado en resultados de switching de redes (rFIC/ACC como outflow hub): en Kiln, definir un “switch trigger” explícito (p. ej., combinación de: alta complejidad + señales de prompt injection + presupuesto alto) y comparar contra un baseline sin switching explícito. El objetivo es medir: (a) calidad final, (b) número de reintentos, (c) frecuencia de tool calls peligrosas bloqueadas a tiempo, y (d) trazabilidad de causa. citeturn16view0turn7view1

Modelar el gate de herramientas como un **mecanismo de inhibición multinivel** y evaluarlo con pruebas de fault injection:  
- presináptico (input throttling): limitar o etiquetar inputs de adapters/usuarios que disparan alto riesgo;  
- postsináptico (deny/approval): bloquear ejecución;  
- recurrente (estabilidad): circuit breaker y backoff para evitar loops.  
Comparar cuál nivel captura mejor cada tipo de fallo (prompt injection, abuso de herramientas, tormentas de reintentos). citeturn8search2turn8search1turn11view0

Implementar pruebas de “**arbitraje único**” para estrategias supervisor/swarm: diseñar un conjunto de escenarios donde múltiples agentes proponen herramientas o modelos distintos, y verificar por propiedad (property-based testing) que el runtime siempre produce un único ganador con razones trazables, y que los perdedores quedan inhibidos sin side effects. Vincular el criterio de éxito a la motivación biológica de “selección con inhibición de competidores”, no a heurísticas ad-hoc. citeturn1search0turn9view2

Revisar el EventBus para soportar auditoría estilo “neurofisiología de runtime”: definir un **mínimo conjunto de eventos invariantes** para reconstruir causalidad (input → gating → routing → tool/run → output), y ejecutar un “replay” determinista desde ring buffer + checkpoints. La prueba de éxito: reproducir una sesión fallida y demostrar por qué ocurrió una escalación, un bloqueo o un fallback.

Priorizar un “**catálogo de estados globales**” (modo de sesión) inspirado por coordinación global (p. ej., atención vs sueño como estados con políticas distintas en TRN): en Kiln, estados como *Normal*, *High-Risk*, *Degraded*, *Approval-Only*, *Circuit-Open*. Para cada estado: políticas de routing, gating, presupuestos, y límites de fallback. La evidencia que soporta esta idea es que circuitos de gating talámico varían por estado y escala, no son constantes. citeturn11view0turn11view2