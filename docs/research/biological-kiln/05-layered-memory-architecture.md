# Arquitectura de Memoria en Capas para Kiln

## Taxonomía de memorias

El sistema Kiln cuenta con múltiples niveles de memoria (estado de conversación, memoria de contacto, RAG de conocimiento, estado de sesión, registro de sesión, sistema de habilidades, memoria entre agentes). Proponemos la siguiente taxonomía inspirada en la ciencia cognitiva:  

- **Memoria de trabajo (corto plazo):** Contexto de la conversación actual. Equivalente cognitivo a la atención activa. Tiene baja capacidad temporal (segundos/minutos)【25†L1106-L1113】.  
- **Memoria episódica:** Registros de eventos o interacciones específicas (por ejemplo, transcripciones de sesiones pasadas). Son recuerdos personales con contexto espacial-temporal【28†L150-L158】.  
- **Memoria semántica (largo plazo):** Conocimiento estructurado: hechos, conceptos generales y reglas del dominio. Posee gran capacidad y la información se recupera según el contexto conceptual【18†L20-L24】.  
- **Memoria procedimental:** Habilidades o rutinas de uso de herramientas y ejecución de tareas (por ejemplo, flujos de trabajo automáticos, uso de APIs repetido). Guarda las “recetas” o modelos de ejecución automática【21†L210-L216】.  
- **Memoria de contacto:** Hechos personales sobre un usuario o contacto (perfil, preferencias, historial). Es un subconjunto de memoria semántica centrado en el usuario como contexto.  
- **Consolidación:** Proceso biológico de estabilidad que mueve un recuerdo de la memoria de corto plazo a largo plazo【5†L152-L160】. En humanos involucra fases sináptica y de sistemas (hipocampo a corteza) sobre días/semanas.  
- **Reconsolidación:** Cuando se reactiva un recuerdo consolidado, la memoria se vuelve maleable de nuevo, permitiendo fortalecerla o modificarla【30†L25-L28】.  
- **Olvido/Decaimiento:** Las memorias a corto plazo decaen rápidamente si no se refuerzan. En la memoria a largo plazo, el olvido ocurre por interferencia con nueva información o falta de acceso【23†L153-L160】【23†L209-L212】.  
- **Recuperación mediante pistas:** La memoria se reacciona mejor con claves contextuales. Según Tulving, el solapamiento entre el contexto de codificación y recuperación favorece el recuerdo【14†L234-L242】. El hipocampo realiza “completitud de patrones”, de modo que una señal parcial puede reactivar el recuerdo completo【14†L262-L267】.  

## Mecanismos

- **Memoria de trabajo (corto plazo):** En el cerebro la corteza prefrontal mantiene activamente información relevante para la tarea【25†L1106-L1113】. Este buffer es de capacidad limitada y requiere atención para refrescarse. Sin refuerzo, las huellas de corto plazo se desvanecen rápidamente por decaimiento【23†L153-L160】.  
- **Memoria episódica:** Depende del hipocampo y corteza temporal medial. Almacena *experiencias* concretas con contexto (qué, dónde, cuándo)【28†L150-L158】. La recuperación de un episodio reestablece el contexto completo (recolección de detalles). Biológicamente, evoca emociones y sensaciones asociadas.  
- **Memoria semántica:** Reside en redes corticales distribuidas y almacena conocimientos independientes del contexto. Contiene hechos y conceptos generales con alta fidelidad【18†L20-L24】. Su organización es abstracta (p. ej. asociaciones de significado). El acceso semántico no depende del estado interno, pero sí de claves conceptuales.  
- **Memoria procedimental:** Relacionada con ganglios basales y cerebelo. Retiene habilidades motrices y hábitos automáticos (como andar en bici o usar comandos) sin requerir conciencia 【21†L210-L216】. Se consolida mediante práctica repetida y se ejecuta sin consumir atención explícita.  
- **Consolidación:** La estabilización del recuerdo ocurre en fases: a corto plazo (horas, potenciación sináptica) y largo plazo (días, reubicación hipocampo–corteza)【5†L152-L160】. Implica cambios moleculares y estructurales que fijan el engrama.  
- **Reconsolidación:** Al reactivar un recuerdo viejo este vuelve a un estado lábil y requiere volver a consolidarse【30†L25-L28】. Permite modificar memorias antiguas (p. ej. actualizar información nueva) y se asocia a síntesis proteica.  
- **Olvido/Decaimiento:** Los datos en la memoria se pierden con el tiempo. En el corto plazo ocurre por decaimiento de la huella física【23†L153-L160】. En el largo plazo, el olvido surge por interferencia con nueva información o por fallos en la recuperación【23†L209-L212】. Además, sin consolidación completa, un recuerdo reciente puede borrarse.  
- **Recuperación con pistas:** La reactivación exitosa depende de pistas. La *especificidad de codificación* dicta que el recuerdo es más fácil si el contexto coincide【14†L234-L242】. El hipocampo realiza “completitud de patrones”: una pista parcial (una palabra clave o imagen) dispara la reconstitución completa del recuerdo【14†L262-L267】. Cada recuperación reconstruye parcialmente el recuerdo, pudiendo alterarlo.

## Abstracciones de software

En sistemas informáticos las memorias biológicas se reflejan en capas de almacenamiento:

- **Capa inmediata (cache/estado):** Espacio temporal (p. ej. memoria RAM o estructuras en memoria) que guarda el contexto activo. Equivale a la memoria de trabajo: debe ser rápida, limitada y borrarse al cerrar la sesión.  
- **Capa de eventos (logs/bitácoras):** Almacén secuencial de interacciones. Análogo a la memoria episódica: registra cada paso de la sesión para auditoría o replay. Por ejemplo, guardar la transcripción de la conversación en un log.  
- **Capa de conocimiento (BD persistente, índices, vectores):** Representa la memoria semántica. Contiene documentos, hechos y datos estructurados. Emplea bases de datos relacionales o *full-text* (SQLite+FTS) y almacenes vectoriales (PgVector/HNSW). Requiere búsquedas eficientes por texto o similitud de embeddings, seguido de un **reranking** para mayor relevancia.  
- **Capa de reglas/acciones:** Paralela a la memoria procedimental. Contiene definiciones de procedimientos y macros (p. ej. archivos *SKILL.md*, scripts o políticas codificadas). No se accede por texto sino invocando la acción correspondiente.  
- **Mecanismo de consolidación:** Procesos que “mueven” datos del estado temporal a la base permanente (por ejemplo, al finalizar una sesión). En software es similar a un flujo ETL: extraer insights del diálogo y *commit* en la base de conocimiento (p. ej. añadir un resumen al repositorio).  
- **Mecanismo de reconsolidación:** Equivale a actualizar un dato existente. Implica re-entrenar o re-indexar cuando llega información nueva. Por ejemplo, corregir los vectores o actualizar los documentos de usuarios al re-sincronizar fuentes.  
- **Políticas de olvido:** Reglas automáticas de eliminación. Se usan *time-to-live* (TTL), algoritmos LRU, poda por edad o relevancia. Datos antiguos o no usados se descartan (p. ej. limpiar variables de sesión al terminar, o caducar shards de vectores poco usados).  
- **Recuperación con pistas:** Mecanismos de búsqueda basados en claves. En software, al recibir una consulta (palabras clave o vector de contexto) se localizan coincidencias en la memoria semántica, como hace un motor de búsqueda o RAG. Debe mapear la “pista” (texto, metadata) a los datos relevantes.

Estas abstracciones establecen límites claros: por ejemplo, el estado de sesión no mezcla datos de memoria a largo plazo sin procesos formales. Cada capa tiene almacenamiento y acceso optimizado propio.

## Mapeos directos a Kiln

- **Estado de conversación (Memoria de trabajo):** En Kiln es *Session State* + *Session Registry*. Contiene el historial de mensajes recientes, variables temporales, modo actual, etc. Se mantiene en memoria RAM o Redis con reglas de corta vida (cada sesión independiente). No se sincroniza con la memoria persistente directamente.  
- **Continuidad de sesión:** *SessionStore* permite rehidratar contexto al reconectar. Guarda metadatos mínimos (versiones, conteo de tokens, etc.) para continuar, pero sin reenviar toda la conversación anterior. Garantiza consistencia entre turnos.  
- **Artefactos de contexto de proyecto:** Datos específicos de un proyecto/organización (documentos, configuraciones) que se inyectan en la sesión. Actúan como memoria semántica contextual. Se almacenan en *Knowledge RAG* o en el *Memory Store* con ámbito de proyecto, y se recuperan según la tarea.  
- **Memoria a largo plazo:** El *Memory Store* global de Kiln (SQLite + vectores) es la memoria semántica persistente. Aquí residen hechos del dominio, notas de usuario y resultados de RAG. Se indexa texto completo (FTS) y embeddings (PgVector). Se accede con consultas y se potencia con re-ranking Cohere.  
- **Memoria de contacto:** Servicio dedicado que extrae y guarda datos personales al inicio de sesión (nombre, roles, preferencias). Es una memoria semántica personalizada por usuario. Se carga automáticamente cada sesión de ese usuario. Debe cumplir GDPR (soporta borrado completo a petición).  
- **Aprendizaje de uso de herramientas (Memoria procedimental):** Corresponde al sistema de habilidades (*Skill system*). Cada skill capturada (archivo *SKILL.md* o flujo aprendido) es una rutina procedural. Se almacena en *SkillRegistry* y puede actualizarse automáticamente. Permite ejecutar tareas complejas sin redescubrirlas.  
- **Memoria entre agentes (SwarmStore):** Coordinación de estado global en entornos multi-agente (via MCP). Es parecido a memoria episódica compartida: acciones como *join/leave/broadcast* quedan registradas para sincronización. Mantiene coherencia de grupo.  
- **Consolidación/Reconsolidación en Kiln:** Al final de cada sesión, el *SkillCaptureService* u otros módulos determinan qué información guardar. Por ejemplo, notas importantes del diálogo se consolidan en el *Memory Store*. Si luego se recupera la misma información, se puede *reconsolidar* (reindexar vectores, refinar embeddings) con los datos nuevos de la conversación.  
- **Olvido en Kiln:** Kiln aplica *decay exponencial* y compactación en el Memory Store. Las variables de sesión se desechan al terminar la sesión; la *memoria de contacto* expira o se borra bajo petición. Además, hay límites configurables (por usuario/proyecto) para descartar datos obsoletos o redundantes.  
- **Recuperación con pistas:** Kiln emplea RAG con embeddings: un prompt del usuario actúa como pista. Se realiza *over-fetch* de documentos similares (4×) y luego *Cohere Reranker* ajusta la relevancia. Este flujo simula cómo las pistas contextuales en el cerebro traen recuerdos relevantes【14†L234-L242】. 

## Riesgos y malos usos

- **Memoria incorrecta o sucia:** Si se mezclan accidentalmente capas, Kiln puede usar datos erróneos. Por ejemplo, llevar una variable de sesión a la base de conocimiento poluciona la memoria a largo plazo, provocando alucinaciones. Es crucial aislar claramente cada capa.  
- **Privacidad y sesgo:** La *memoria de contacto* almacena datos personales. Una mala delimitación con la memoria semántica global puede filtrar información sensible a otros contextos. Además, puede perpetuar sesgos del usuario. Se deben implementar controles estrictos (p.ej. cifrado o borrado selectivo) y cumplir regulaciones (GDPR).  
- **Obsolescencia y alucinaciones:** Datos acumulados sin refresco pueden generar respuestas incorrectas. Si no se poda información obsoleta, el sistema “recuerda” equivocadamente. Por otro lado, olvidar en exceso puede eliminar contexto útil. Los parámetros de decay deben calibrarse al dominio para equilibrar memoria útil vs ruido.  
- **Dependencia de la analogía:** Insistir en copiar fielmente cada mecanismo biológico puede complicar el diseño sin beneficio. Kiln no necesita, por ejemplo, un módulo llamado “hipocampo”; importa más la función (almacenar/recuperar contextos) que la metáfora concreta.  
- **Sincronización en memoria compartida:** En modos *Swarm*, la coherencia de la memoria distribuida es difícil. Fallos en la sincronización pueden generar conflictos de estado (e.g. dos agentes claman un recurso simultáneamente). Hay que diseñar locks o versiones para evitar colisiones.  
- **Ataques adversariales:** Al recordar datos a largo plazo (especialmente en vectores), Kiln es vulnerable a inyección de información maliciosa. Un usuario podría insertar datos dañinos en la RAG que luego afecten respuestas futuras. Se necesita filtrar y validar la memoria ingerida.  

## Dónde la analogía falla

- **Almacenamiento determinista vs neural:** El cerebro usa redes ruidosas y aproximadas; Kiln usa bases de datos exactas y vectores precisos. En Kiln, la recuperación es literal: no hay reconstrucción creativa a menos que lo haga explícitamente el LLM.  
- **Escalas temporales distintas:** Los procesos biológicos de consolidación toman días o años, involucrando sueño y plasticidad continua. En Kiln todo es inmediato (un commit es instantáneo) y no existen fases tipo sueño.  
- **Falta de emociones:** Las memorias humanas se colorean con emociones y contexto corporal; Kiln carece por completo de esto. Un evento estresante en la interacción no recibe tratamiento especial salvo las palabras que lo describan.  
- **Sin plasticidad de hardware:** Kiln no crea nuevas “sinapsis” físicas. Su estructura de memoria (tablas y vectores) es fija. La “plasticidad” se logra solo modificando datos, no reconfigurando hardware.  
- **Creative recall vs lógica estricta:** El humano reconstruye recuerdos inconsistentes; Kiln sólo “recuerda” datos guardados. No inventa detalles que no existen, excepto por la interpretación del LLM. Sin embargo, puede mezclar información reciente de manera que un humano no lo haría (ej. confundir dos conversaciones si la persistencia no está aislada).  
- **Fidelidad de la memoria:** Los humanos pierden detalles y rellenan huecos; Kiln sólo “olvida” si así se programa. Además Kiln no confunde objetos por similitud sensorial espontáneamente. 

## Seguimientos de investigación accionables

- **Evaluar modelos cognitivos híbridos:** Explorar arquitecturas cognitivas (ACT-R, SOAR, etc.) para inspirar módulos de memoria en Kiln, balanceando flexibilidad y eficiencia.  
- **Optimizar consolidación:** Investigar políticas automáticas que decidan qué guardar permanentemente. Por ejemplo, determinar criterios para *commit* del contenido de la sesión a la memoria a largo plazo (¿qué tipo de información o umbral de importancia lo amerita?).  
- **Algoritmos de olvido adaptativo:** Desarrollar estrategias de poda basadas en uso real. P. ej. aprendizaje por refuerzo que aprenda qué memorias conservar o desechar según su utilidad en conversaciones futuras.  
- **Memoria episódica en entornos seguros:** Explorar técnicas de compartimentalización criptográfica para memorias sensibles. Por ejemplo, implementar llaves que cifren partes de la memoria episódica para que ciertos agentes no puedan leerlas, aumentando la privacidad.  
- **Análisis de fallos de memoria:** Registrar casos donde el sistema se contradice por malas referencias (e.g. conflicto entre RAG y contexto de sesión) para ajustar los límites de capas. Estos casos de “colisión” guiarán reglas más estrictas.  
- **Integración de señales contextuales adicionales:** Incorporar metadatos del entorno (estado del sistema, hora, ubicación virtual del usuario) como pistas de recuperación. Esto análogamente enriquece las claves contextuales del entorno humano para desencadenar memorias apropiadas.  
- **Seguridad:** Realizar pruebas de penetración específicas a la memoria de Kiln. Simular ataques de inyección de datos maliciosos en RAG y evaluar el riesgo de propagación. Esto guiará la implementación de validaciones y detección de contenido nocivo.  

**Referencias:** Estudios cognitivos distinguen la memoria de trabajo, episódica y semántica como sistemas separados【25†L1106-L1113】【28†L150-L158】【18†L20-L24】. La memoria procedimental almacena habilidades motoras automáticas【21†L210-L216】. Los procesos de consolidación y reconsolidación estabilizan y actualizan recuerdos【5†L152-L160】【30†L25-L28】, mientras que el olvido sucede por decaimiento o interferencia【23†L153-L160】【23†L209-L212】. Además, la recuperación óptima depende de claves contextuales【14†L234-L242】【14†L262-L267】. Estas bases biológicas se traducen en capas de caché, BD persistente e índices en Kiln, respetando límites claros entre la memoria efímera y permanente.