// ===============================================
// MIDDLEWARE DE MONITORAMENTO
// ===============================================
// Monitora performance e logs de requisições

const SLOW_REQUEST_THRESHOLD = 3000; // 3 segundos
const ENABLE_LOGGING = process.env.ENABLE_REQUEST_LOGGING !== 'false';

const monitoring = (req, res, next) => {
    const start = Date.now();
    const requestId = generateRequestId();

    // Adicionar ID único à requisição
    req.requestId = requestId;

    // Capturar quando a resposta terminar
    res.on('finish', () => {
        const duration = Date.now() - start;
        const logData = {
            requestId,
            method: req.method,
            path: req.path,
            status: res.statusCode,
            duration: `${duration}ms`,
            timestamp: new Date().toISOString(),
            userAgent: req.get('user-agent'),
            ip: req.ip || req.connection.remoteAddress,
        };

        // Log estruturado
        if (ENABLE_LOGGING) {
            if (res.statusCode >= 500) {
                console.error('❌ SERVER ERROR:', logData);
            } else if (res.statusCode >= 400) {
                console.warn('⚠️  CLIENT ERROR:', logData);
            } else if (duration > SLOW_REQUEST_THRESHOLD) {
                console.warn('🐌 SLOW REQUEST:', logData);
            } else {
                console.log('✅', logData);
            }
        }

        // Alertar sobre requisições muito lentas
        if (duration > SLOW_REQUEST_THRESHOLD) {
            console.warn(
                `⚠️  Requisição lenta detectada: ${req.method} ${req.path} (${duration}ms)`
            );
        }
    });

    next();
};

const generateRequestId = () => {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// Middleware de health check
const healthCheck = (req, res) => {
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();

    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        uptime: `${Math.floor(uptime / 60)}m ${Math.floor(uptime % 60)}s`,
        memory: {
            rss: `${(memoryUsage.rss / 1024 / 1024).toFixed(2)} MB`,
            heapUsed: `${(memoryUsage.heapUsed / 1024 / 1024).toFixed(2)} MB`,
            heapTotal: `${(memoryUsage.heapTotal / 1024 / 1024).toFixed(2)} MB`,
        },
        env: process.env.NODE_ENV || 'development',
    });
};

// Middleware de erro global
const errorHandler = (err, req, res, next) => {
    console.error('💥 ERRO NÃO TRATADO:', {
        requestId: req.requestId,
        error: err.message,
        stack: err.stack,
        path: req.path,
        method: req.method,
    });

    // Não expor detalhes do erro em produção
    const isDev = process.env.NODE_ENV !== 'production';

    res.status(err.status || 500).json({
        error: isDev ? err.message : 'Erro interno do servidor',
        requestId: req.requestId,
        ...(isDev && { stack: err.stack }),
    });
};

module.exports = {
    monitoring,
    healthCheck,
    errorHandler,
};
