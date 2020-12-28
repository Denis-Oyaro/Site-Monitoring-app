/*
 * Request handlers
 */

// Dependencies
const _data = require('./data');
const helpers = require('./helpers');
const config = require('./config');

// Define request handlers
const handlers = {};

// Ping handler
handlers.ping = function (data, callback) {
    callback(200);
};

// Not found handler
handlers.notFound = function (data, callback) {
    callback(404);
};

// Users handler
handlers.users = function (data, callback) {
    const acceptableMethods = ['post', 'get', 'put', 'delete'];
    if (acceptableMethods.indexOf(data.method) > -1) {
        handlers._users[data.method](data, callback);
    } else {
        callback(405);
    }
};

// Container for the users sub methods
handlers._users = {};

// Users - post
// Required data: firstname, lastname, phone, password, tosAgreement
// Optional data: none
handlers._users.post = function (data, callback) {
    // Check that all required fields are filled out
    const firstname = typeof data.payload.firstname === 'string' ? data.payload.firstname.trim() : '';
    const lastname = typeof data.payload.lastname === 'string' ? data.payload.lastname.trim() : '';
    const phone = typeof data.payload.phone === 'string' && data.payload.phone.trim().length === 10 ? data.payload.phone.trim() : '';
    const password = typeof data.payload.password === 'string' ? data.payload.password.trim() : '';
    const tosAgreement = typeof data.payload.tosAgreement === 'boolean' ? data.payload.tosAgreement : false;

    if (firstname && lastname && phone && password && tosAgreement) {
        // Make sure the user doesn't already exist
        _data.read('users', phone, function (err, data) {
            if (err) {
                // Hash the password
                const hashedPassword = helpers.hash(password);

                // Create the user object
                if (hashedPassword) {
                    const userObject = { firstname, lastname, phone, hashedPassword, tosAgreement: true };

                    // Store the user
                    _data.create('users', phone, userObject, function (err) {
                        if (err) {
                            console.log(err);
                            callback(500, { Error: 'Could not create the new user' });
                        } else {
                            callback(200);
                        }
                    });
                } else {
                    callback(500, { Error: "Could not hash the user's password" });
                }
            } else {
                // User already exists
                callback(400, { Error: 'A user with that phone number already exists' });
            }
        });
    } else {
        callback(400, { Error: 'Missing required fields' });
    }
};

// Users - get
// Required data: phone
// Optional data: none
handlers._users.get = function (data, callback) {
    // Check that the phone number is valid
    const phone =
        typeof data.queryStringObject.get('phone') === 'string' && data.queryStringObject.get('phone').trim().length === 10
            ? data.queryStringObject.get('phone').trim()
            : '';
    if (phone) {
        // Get the token from the headers
        const token = typeof data.headers.token === 'string' ? data.headers.token : '';

        // Verify that the given token is valid for the phone number
        handlers._tokens.verifyToken(token, phone, function (tokenIsValid) {
            if (tokenIsValid) {
                // Look up the user
                _data.read('users', phone, function (err, data) {
                    if (err) {
                        callback(404);
                    } else {
                        // Remove the hashed password from the object before returning it to the requester
                        delete data.hashedPassword;
                        // return object to requester
                        callback(200, data);
                    }
                });
            } else {
                callback(403, { Error: 'Missing required token in header, or token is invalid' });
            }
        });
    } else {
        callback(400, { Error: 'Missing required field' });
    }
};

// Users - put
// Required data: phone
// Optional data: firstname, lastname, password (at least one must be specified)
handlers._users.put = function (data, callback) {
    // Check for the required field
    const phone = typeof data.payload.phone === 'string' && data.payload.phone.trim().length === 10 ? data.payload.phone.trim() : '';

    // Check for the optional fields
    const firstname = typeof data.payload.firstname === 'string' ? data.payload.firstname.trim() : '';
    const lastname = typeof data.payload.lastname === 'string' ? data.payload.lastname.trim() : '';
    const password = typeof data.payload.password === 'string' ? data.payload.password.trim() : '';

    // Error if phone is valid
    if (phone) {
        // Get the token from the headers
        const token = typeof data.headers.token === 'string' ? data.headers.token : '';

        // Verify that the given token is valid for the phone number
        handlers._tokens.verifyToken(token, phone, function (tokenIsValid) {
            if (tokenIsValid) {
                // Error if nothing is sent to update
                if (firstname || lastname || password) {
                    // look up user
                    _data.read('users', phone, function (err, userData) {
                        if (err) {
                            console.log(err);
                            callback(400, { Error: 'The specified user does not exist' });
                        } else {
                            // update necessary fields
                            userData.firstname = firstname || userData.firstname;
                            userData.lastname = lastname || userData.lastname;
                            userData.hashedPassword = helpers.hash(password) || userData.hashedPassword;

                            // Store the new updates
                            _data.update('users', phone, userData, function (err) {
                                if (err) {
                                    console.log(err);
                                    callback(500, { Error: 'Could not update the user' });
                                } else {
                                    callback(200);
                                }
                            });
                        }
                    });
                } else {
                    callback(400, { Error: 'Missing fields to update' });
                }
            } else {
                callback(403, { Error: 'Missing required token in header, or token is invalid' });
            }
        });
    } else {
        callback(400, { Error: 'Missing required field' });
    }
};

// Users - delete
// Required field: phone
handlers._users.delete = function (data, callback) {
    // Check that the phone number is valid
    const phone =
        typeof data.queryStringObject.get('phone') === 'string' && data.queryStringObject.get('phone').trim().length === 10
            ? data.queryStringObject.get('phone').trim()
            : '';
    if (phone) {
        // Get the token from the headers
        const token = typeof data.headers.token === 'string' ? data.headers.token : '';

        // Verify that the given token is valid for the phone number
        handlers._tokens.verifyToken(token, phone, function (tokenIsValid) {
            if (tokenIsValid) {
                // Look up the user
                _data.read('users', phone, function (err, userData) {
                    if (err) {
                        callback(400, { Error: 'Could not find the specified user' });
                    } else {
                        // Delete user
                        _data.delete('users', phone, function (err) {
                            if (err) {
                                callback(500, { Error: 'Could not delete the specified user' });
                            } else {
                                // Delete each of the checks associated with the user
                                const userChecks = userData.checks instanceof Array ? userData.checks : [];
                                const checksToDelete = userChecks.length;
                                if (checksToDelete > 0) {
                                    let checksDeleted = 0;
                                    let deletionErrors = false;

                                    // Loop through the checks
                                    userChecks.forEach(function (checkId) {
                                        // Delete the check
                                        _data.delete('checks', checkId, function (err) {
                                            if (err) {
                                                deletionErrors = true;
                                            }
                                            checksDeleted += 1;
                                            if (checksDeleted === checksToDelete) {
                                                if (deletionErrors) {
                                                    callback(500, {
                                                        Error:
                                                            "One or more errors encountered while attempting to delete user's checks. All of user's checks may not have been deleted from the system successfully",
                                                    });
                                                } else {
                                                    callback(200);
                                                }
                                            }
                                        });
                                    });
                                } else {
                                    callback(200);
                                }
                            }
                        });
                    }
                });
            } else {
                callback(403, { Error: 'Missing required token in header, or token is invalid' });
            }
        });
    } else {
        callback(400, { Error: 'Missing required field' });
    }
};

// Tokens handler
handlers.tokens = function (data, callback) {
    const acceptableMethods = ['post', 'get', 'put', 'delete'];
    if (acceptableMethods.indexOf(data.method) > -1) {
        handlers._tokens[data.method](data, callback);
    } else {
        callback(405);
    }
};

// Container for the tokens sub methods
handlers._tokens = {};

// Tokens - post
// Required data: phone, password
// Optional data: none
handlers._tokens.post = function (data, callback) {
    // Check that required fields are filled out
    const phone = typeof data.payload.phone === 'string' && data.payload.phone.trim().length === 10 ? data.payload.phone.trim() : '';
    const password = typeof data.payload.password === 'string' ? data.payload.password.trim() : '';

    if (phone && password) {
        // Look up the user who matches that phone number
        _data.read('users', phone, function (err, userData) {
            if (err) {
                callback(400, { Error: 'Could not find the specified user' });
            } else {
                // Hash the sent password and compare it to the password in userData object
                if (helpers.hash(password) === userData.hashedPassword) {
                    // If valid, create a new token with a random name. Set expiration date 1 hour in the future
                    const tokenId = helpers.createRandomString(20);
                    const expires = Date.now() + 1000 * 60 * 60;
                    const tokenObject = { id: tokenId, expires, phone };

                    // Store the token
                    _data.create('tokens', tokenId, tokenObject, function (err) {
                        if (err) {
                            callback(500, { Error: 'Could not create the new token' });
                        } else {
                            callback(200, tokenObject);
                        }
                    });
                } else {
                    callback(401, { Error: "Password did not match the specified user's stored password" });
                }
            }
        });
    } else {
        callback(400, { Error: 'Missing required field(s)' });
    }
};

// Tokens - get
// Required data: id
// Optional data: none
handlers._tokens.get = function (data, callback) {
    // Check that the id is valid
    const id =
        typeof data.queryStringObject.get('id') === 'string' && data.queryStringObject.get('id').trim().length === 20
            ? data.queryStringObject.get('id').trim()
            : '';
    if (id) {
        // Look up the token
        _data.read('tokens', id, function (err, tokenData) {
            if (err) {
                callback(404);
            } else {
                // return object to requester
                callback(200, tokenData);
            }
        });
    } else {
        callback(400, { Error: 'Missing required field' });
    }
};

// Tokens - put
// Required data: id, extend
// Optional data: none
handlers._tokens.put = function (data, callback) {
    // Check that the id and extend is valid
    const id = typeof data.payload.id === 'string' && data.payload.id.trim().length === 20 ? data.payload.id.trim() : '';
    const extend = typeof data.payload.extend === 'boolean' ? data.payload.extend : false;

    if (id && extend) {
        // Look up the token
        _data.read('tokens', id, function (err, tokenData) {
            if (err) {
                callback(400, { Error: 'The specified token does not exist' });
            } else {
                // Check to make sure the token isn't already expired
                if (tokenData.expires > Date.now()) {
                    // Set the expiration an hour from now
                    tokenData.expires = Date.now() + 1000 * 60 * 60;

                    // Store the new updates
                    _data.update('tokens', id, tokenData, function (err) {
                        if (err) {
                            callback(500, { Error: "Could not update the token's expiration" });
                        } else {
                            callback(200);
                        }
                    });
                } else {
                    callback(400, { Error: 'The token has expired, and cannot be extended' });
                }
            }
        });
    } else {
        callback(400, { Error: 'Missing required field(s) or field(s) are invalid' });
    }
};

// Tokens - delete
// Required data: id
// Optional data: none
handlers._tokens.delete = function (data, callback) {
    // Check that the id is valid
    const id =
        typeof data.queryStringObject.get('id') === 'string' && data.queryStringObject.get('id').trim().length === 20
            ? data.queryStringObject.get('id').trim()
            : '';
    if (id) {
        // Look up the token
        _data.read('tokens', id, function (err, data) {
            if (err) {
                callback(400, { Error: 'Could not find the specified token' });
            } else {
                // Delete token
                _data.delete('tokens', id, function (err) {
                    if (err) {
                        console.log(err);
                        callback(500, { Error: 'Could not delete the specified token' });
                    } else {
                        callback(200);
                    }
                });
            }
        });
    } else {
        callback(400, { Error: 'Missing required field' });
    }
};

// Verify if a given token id is currently valid for a given user
handlers._tokens.verifyToken = function (id, phone, callback) {
    if (!id || !phone) {
        callback(false);
    } else {
        // look up the token
        _data.read('tokens', id, function (err, tokenData) {
            if (err) {
                callback(false);
            } else {
                // Check that the token is for the given user, and has not expired
                const tokenValid = tokenData.phone === phone && tokenData.expires > Date.now();
                callback(tokenValid);
            }
        });
    }
};

// Checks handler
handlers.checks = function (data, callback) {
    const acceptableMethods = ['post', 'get', 'put', 'delete'];
    if (acceptableMethods.indexOf(data.method) > -1) {
        handlers._checks[data.method](data, callback);
    } else {
        callback(405);
    }
};

// Container for the checks sub methods
handlers._checks = {};

// Checks - post
// Required data: protocol, url, method, successCodes, timeoutSeconds
// Optional data: none
handlers._checks.post = function (data, callback) {
    // Validate inputs
    const protocol = typeof data.payload.protocol === 'string' && ['https', 'http'].indexOf(data.payload.protocol) > -1 ? data.payload.protocol : '';
    const url = typeof data.payload.url === 'string' ? data.payload.url.trim() : '';
    const method = typeof data.payload.method === 'string' && ['post', 'get', 'put', 'delete'].indexOf(data.payload.method) > -1 ? data.payload.method : '';
    const successCodes = data.payload.successCodes instanceof Array && data.payload.successCodes.length > 0 ? data.payload.successCodes : [];
    const timeoutSeconds =
        typeof data.payload.timeoutSeconds === 'number' &&
        data.payload.timeoutSeconds % 1 === 0 &&
        data.payload.timeoutSeconds >= 1 &&
        data.payload.timeoutSeconds <= 5
            ? data.payload.timeoutSeconds
            : 0;

    if (protocol && url && method && successCodes.length > 0 && timeoutSeconds) {
        // Get the token from the headers
        const token = typeof data.headers.token === 'string' ? data.headers.token : '';

        // Look up the user by reading the token
        _data.read('tokens', token, function (err, tokenData) {
            if (err) {
                callback(403, { Error: 'Missing or invalid token' });
            } else {
                // Validate token
                if (tokenData.expires > Date.now()) {
                    const userPhone = tokenData.phone;

                    // Look up the user data
                    _data.read('users', userPhone, function (err, userData) {
                        if (err) {
                            callback(403, { Error: 'There is no user associated with the provided token' });
                        } else {
                            const userChecks = userData.checks instanceof Array ? userData.checks : [];

                            // Verify that the user has less than the max number of checks per user
                            if (userChecks.length < config.maxChecks) {
                                // Create a random id for the check
                                const checkId = helpers.createRandomString(20);

                                // Create the check object, and include the user's phone
                                const checkObject = { id: checkId, userPhone, protocol, url, method, successCodes, timeoutSeconds };

                                // Store the check object
                                _data.create('checks', checkId, checkObject, function (err) {
                                    if (err) {
                                        callback(500, { Error: 'Could not create the new check' });
                                    } else {
                                        // Add the check id to the user's data object
                                        userChecks.push(checkId);
                                        userData.checks = userChecks;

                                        // update the user
                                        _data.update('users', userPhone, userData, function (err) {
                                            if (err) {
                                                callback(500, { Error: 'Could not update the user with the new check' });
                                            } else {
                                                // Return the data about the new check to the requester
                                                callback(200, checkObject);
                                            }
                                        });
                                    }
                                });
                            } else {
                                callback(400, { Error: `The user already has the maximum number (${config.maxChecks}) of checks` });
                            }
                        }
                    });
                } else {
                    callback(403, { Error: 'Token has expired' });
                }
            }
        });
    } else {
        callback(400, { Error: 'Missing required fields, or fields are invalid' });
    }
};

// Checks - get
// Required data: id
// Optional data: none
handlers._checks.get = function (data, callback) {
    // Check that the id is valid
    const id =
        typeof data.queryStringObject.get('id') === 'string' && data.queryStringObject.get('id').trim().length === 20
            ? data.queryStringObject.get('id').trim()
            : '';
    if (id) {
        // Look up the check
        _data.read('checks', id, function (err, checkData) {
            if (err) {
                callback(404);
            } else {
                const userPhone = checkData.userPhone;

                // Get the token from the headers
                const token = typeof data.headers.token === 'string' ? data.headers.token : '';

                // Verify that the given token is valid and belongs to user who created the check
                handlers._tokens.verifyToken(token, userPhone, function (tokenIsValid) {
                    if (tokenIsValid) {
                        // Return the check data
                        callback(200, checkData);
                    } else {
                        callback(403, { Error: 'Missing required token in header, or token is invalid' });
                    }
                });
            }
        });
    } else {
        callback(400, { Error: 'Missing required field' });
    }
};

// Checks - put
// Required data: id
// Optional data: protocol, url, method, successCodes, timeoutSeconds (one must be sent)
handlers._checks.put = function (data, callback) {
    // Check for the required field
    const id = typeof data.payload.id === 'string' && data.payload.id.trim().length === 20 ? data.payload.id.trim() : '';

    // Check for the optional fields
    const protocol = typeof data.payload.protocol === 'string' && ['https', 'http'].indexOf(data.payload.protocol) > -1 ? data.payload.protocol : '';
    const url = typeof data.payload.url === 'string' ? data.payload.url.trim() : '';
    const method = typeof data.payload.method === 'string' && ['post', 'get', 'put', 'delete'].indexOf(data.payload.method) > -1 ? data.payload.method : '';
    const successCodes = data.payload.successCodes instanceof Array && data.payload.successCodes.length > 0 ? data.payload.successCodes : [];
    const timeoutSeconds =
        typeof data.payload.timeoutSeconds === 'number' &&
        data.payload.timeoutSeconds % 1 === 0 &&
        data.payload.timeoutSeconds >= 1 &&
        data.payload.timeoutSeconds <= 5
            ? data.payload.timeoutSeconds
            : 0;

    // Check to make sure id is valid
    if (id) {
        // Check to make sure one or more optional fields have been sent
        if (protocol || url || method || successCodes.length > 0 || timeoutSeconds) {
            // Look up the check
            _data.read('checks', id, function (err, checkData) {
                if (err) {
                    callback(400, { Error: 'Check does not exist' });
                } else {
                    const userPhone = checkData.userPhone;

                    // Get the token from the headers
                    const token = typeof data.headers.token === 'string' ? data.headers.token : '';

                    // Verify that the given token is valid and belongs to user who created the check
                    handlers._tokens.verifyToken(token, userPhone, function (tokenIsValid) {
                        if (tokenIsValid) {
                            // update the check where necessary
                            checkData.protocol = protocol || checkData.protocol;
                            checkData.url = url || checkData.url;
                            checkData.method = method || checkData.method;
                            checkData.timeoutSeconds = timeoutSeconds || checkData.timeoutSeconds;
                            checkData.successCodes = successCodes.length > 0 ? successCodes : checkData.successCodes;

                            // Store the new updates
                            _data.update('checks', id, checkData, function (err) {
                                if (err) {
                                    callback(500, { Error: 'Could not update the check' });
                                } else {
                                    callback(200);
                                }
                            });
                        } else {
                            callback(403, { Error: 'Missing required token in header, or token is invalid' });
                        }
                    });
                }
            });
        } else {
            callback(400, { Error: 'Missing fields to update' });
        }
    } else {
        callback(400, { Error: 'Missing required field' });
    }
};

// Checks - delete
// Required data: id
// Optional data: none
handlers._checks.delete = function (data, callback) {
    // Check that the id is valid
    const id =
        typeof data.queryStringObject.get('id') === 'string' && data.queryStringObject.get('id').trim().length === 20
            ? data.queryStringObject.get('id').trim()
            : '';
    if (id) {
        // Look up the check
        _data.read('checks', id, function (err, checkData) {
            if (err) {
                callback(400, { Error: 'The specified Check does not exist' });
            } else {
                const userPhone = checkData.userPhone;

                // Get the token from the headers
                const token = typeof data.headers.token === 'string' ? data.headers.token : '';

                // Verify that the given token is valid and belongs to user who created the check
                handlers._tokens.verifyToken(token, userPhone, function (tokenIsValid) {
                    if (tokenIsValid) {
                        // Delete the check data
                        _data.delete('checks', id, function (err) {
                            if (err) {
                                callback(500, { Error: 'Could not delete the check data' });
                            } else {
                                // Look up the user
                                _data.read('users', userPhone, function (err, userData) {
                                    if (err) {
                                        callback(500, {
                                            Error:
                                                "Could not find the user who created the check, so could not remove the check from the list of checks on the user's object",
                                        });
                                    } else {
                                        const userChecks = userData.checks instanceof Array ? userData.checks : [];

                                        // Remove deleted check from list of checks on user's object
                                        const checkPosition = userChecks.indexOf(id);
                                        if (checkPosition > -1) {
                                            userChecks.splice(checkPosition, 1);

                                            // Save the new user changes
                                            _data.update('users', userPhone, userData, function (err) {
                                                if (err) {
                                                    callback(500, { Error: 'Could not update the user' });
                                                } else {
                                                    callback(200);
                                                }
                                            });
                                        } else {
                                            callback(500, { Error: "Could not find the check on the user's object, so could not remove it" });
                                        }
                                    }
                                });
                            }
                        });
                    } else {
                        callback(403, { Error: 'Missing required token in header, or token is invalid' });
                    }
                });
            }
        });
    } else {
        callback(400, { Error: 'Missing required field' });
    }
};

// Export module
module.exports = handlers;