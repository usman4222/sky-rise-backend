export const successResponse = (res, message, data = {}, statusCode = 200) => {
    return res.status(statusCode).json({
        success: true,
        message,
        ...data
    });
};

export const sendError = (res, message, statusCode = 500, error = null) => {
    return res.status(statusCode).json({
        success: false,
        message,
        ...(process.env.NODE_ENV === 'development' && error
            ? {
                error: error.message || error
            }
            : {})
    });
};