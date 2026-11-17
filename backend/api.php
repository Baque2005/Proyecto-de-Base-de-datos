<?php
declare(strict_types=1);

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

require_once __DIR__ . '/config/database.php';

try {
    $database = database();
    $action = $_GET['action'] ?? 'summary';

    if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'airports') {
        $statement = $database->query(
            'SELECT id, codigo_iata, nombre, ciudad, pais
             FROM aeropuertos ORDER BY ciudad, codigo_iata'
        );
        respond(['data' => $statement->fetchAll()]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'planes') {
        $statement = $database->query(
            'SELECT id, matricula, modelo, capacidad_total
             FROM aviones ORDER BY matricula'
        );
        respond(['data' => $statement->fetchAll()]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'all-seats') {
        $planeId = (int) ($_GET['plane_id'] ?? 0);
        $sql = 'SELECT a.id, a.avion_id, a.numero_asiento, a.clase,
                       av.matricula, av.modelo
                FROM asientos a
                INNER JOIN aviones av ON av.id = a.avion_id';
        $parameters = [];
        if ($planeId > 0) {
            $sql .= ' WHERE a.avion_id = :plane_id';
            $parameters['plane_id'] = $planeId;
        }
        $sql .= ' ORDER BY av.matricula, a.numero_asiento';
        $statement = $database->prepare($sql);
        $statement->execute($parameters);
        respond(['data' => $statement->fetchAll()]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'flights') {
        $origin = trim((string) ($_GET['origin'] ?? ''));
        $destination = trim((string) ($_GET['destination'] ?? ''));
        $date = trim((string) ($_GET['date'] ?? ''));

        $sql = 'SELECT v.id, v.codigo_vuelo, v.fecha_salida, v.fecha_llegada, v.estado,
                       a_orig.codigo_iata AS origen,
                       a_orig.ciudad AS ciudad_origen,
                       a_dest.codigo_iata AS destino,
                       a_dest.ciudad AS ciudad_destino,
                       av.modelo AS avion
                FROM vuelos v
                INNER JOIN aeropuertos a_orig ON v.origen_id = a_orig.id
                INNER JOIN aeropuertos a_dest ON v.destino_id = a_dest.id
                INNER JOIN aviones av ON v.avion_id = av.id
                WHERE v.estado = :estado';
        $parameters = ['estado' => 'PROGRAMADO'];

        if ($origin !== '') {
            $sql .= ' AND a_orig.codigo_iata = :origin';
            $parameters['origin'] = $origin;
        }
        if ($destination !== '') {
            $sql .= ' AND a_dest.codigo_iata = :destination';
            $parameters['destination'] = $destination;
        }
        if ($date !== '') {
            $sql .= ' AND DATE(v.fecha_salida) = :date';
            $parameters['date'] = $date;
        }

        $sql .= ' ORDER BY v.fecha_salida ASC';
        $statement = $database->prepare($sql);
        $statement->execute($parameters);
        respond(['data' => $statement->fetchAll()]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'seats') {
        $flightId = (int) ($_GET['flight_id'] ?? 0);
        if ($flightId < 1) respond(['error' => 'Selecciona un vuelo válido.'], 422);

        $statement = $database->prepare(
            'SELECT a.id, a.numero_asiento, a.clase
             FROM asientos a
             INNER JOIN vuelos v ON a.avion_id = v.avion_id
             WHERE v.id = :flight_id
               AND a.id NOT IN (
                   SELECT dr.asiento_id
                   FROM detalle_reserva dr
                   INNER JOIN reservas r ON dr.reserva_id = r.id
                   WHERE r.vuelo_id = :occupied_flight_id
                     AND r.estado IN (\'PENDIENTE\', \'CONFIRMADA\')
                     AND dr.estado_asiento IN (\'RESERVADO\', \'PAGADO\')
               )
             ORDER BY a.numero_asiento'
        );
        $statement->execute([
            'flight_id' => $flightId,
            'occupied_flight_id' => $flightId
        ]);
        respond(['data' => $statement->fetchAll()]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'cancel-reservation') {
        $payload = json_decode(file_get_contents('php://input'), true);
        $reservationId = (int) ($payload['reservation_id'] ?? 0);
        if ($reservationId < 1) respond(['error' => 'Selecciona una reserva válida.'], 422);

        $database->beginTransaction();
        $statement = $database->prepare(
            'SELECT id FROM reservas WHERE id = :id FOR UPDATE'
        );
        $statement->execute(['id' => $reservationId]);
        if (!$statement->fetch()) {
            $database->rollBack();
            respond(['error' => 'La reserva no existe.'], 404);
        }

        $database->prepare(
            'UPDATE reservas SET estado = \'CANCELADA\' WHERE id = :id'
        )->execute(['id' => $reservationId]);
        $database->prepare(
            'UPDATE detalle_reserva SET estado_asiento = \'LIBERADO\'
             WHERE reserva_id = :id'
        )->execute(['id' => $reservationId]);
        $database->commit();
        respond(['message' => 'Reserva cancelada y asiento liberado.']);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'confirm-reservation') {
        $payload = json_decode(file_get_contents('php://input'), true);
        $reservationId = (int) ($payload['reservation_id'] ?? 0);
        if ($reservationId < 1) respond(['error' => 'Selecciona una reserva válida.'], 422);

        $database->beginTransaction();
        $statement = $database->prepare(
            'SELECT id, estado FROM reservas WHERE id = :id FOR UPDATE'
        );
        $statement->execute(['id' => $reservationId]);
        $reservation = $statement->fetch();
        if (!$reservation) {
            $database->rollBack();
            respond(['error' => 'La reserva no existe.'], 404);
        }
        if ($reservation['estado'] === 'CANCELADA') {
            $database->rollBack();
            respond(['error' => 'Una reserva cancelada no puede confirmarse.'], 409);
        }

        $database->prepare(
            'UPDATE reservas SET estado = \'CONFIRMADA\' WHERE id = :id'
        )->execute(['id' => $reservationId]);
        $database->prepare(
            'UPDATE detalle_reserva SET estado_asiento = \'PAGADO\'
             WHERE reserva_id = :id'
        )->execute(['id' => $reservationId]);
        $database->commit();
        respond(['message' => 'Reserva confirmada y pago registrado.']);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'POST' && $action === 'reservations') {
        $payload = json_decode(file_get_contents('php://input'), true);
        $flightId = (int) ($payload['flight_id'] ?? 0);
        $seatId = (int) ($payload['seat_id'] ?? 0);
        $identificacion = trim((string) ($payload['identificacion'] ?? ''));
        $nombre = trim((string) ($payload['nombre'] ?? ''));
        $apellido = trim((string) ($payload['apellido'] ?? ''));
        $email = strtolower(trim((string) ($payload['email'] ?? '')));
        $telefono = trim((string) ($payload['telefono'] ?? ''));
        $precio = (float) ($payload['precio'] ?? -1);

        if ($flightId < 1 || $seatId < 1 || $identificacion === '' ||
            $nombre === '' || $apellido === '' || $email === '' || $precio < 0) {
            respond(['error' => 'Completa los datos del pasajero, el vuelo, el asiento y el precio.'], 422);
        }

        $database->beginTransaction();

        $flight = $database->prepare(
            'SELECT id FROM vuelos
             WHERE id = :flight_id AND estado = \'PROGRAMADO\'
             FOR UPDATE'
        );
        $flight->execute(['flight_id' => $flightId]);
        if (!$flight->fetch()) {
            $database->rollBack();
            respond(['error' => 'El vuelo no existe o ya no está disponible.'], 409);
        }

        $seat = $database->prepare(
            'SELECT a.id
             FROM asientos a
             INNER JOIN vuelos v ON v.avion_id = a.avion_id
             WHERE v.id = :flight_id AND a.id = :seat_id
             FOR UPDATE'
        );
        $seat->execute(['flight_id' => $flightId, 'seat_id' => $seatId]);
        if (!$seat->fetch()) {
            $database->rollBack();
            respond(['error' => 'El asiento seleccionado no pertenece al vuelo.'], 422);
        }

        $occupied = $database->prepare(
            'SELECT dr.id
             FROM detalle_reserva dr
             INNER JOIN reservas r ON dr.reserva_id = r.id
             WHERE r.vuelo_id = :flight_id
               AND dr.asiento_id = :seat_id
               AND r.estado IN (\'PENDIENTE\', \'CONFIRMADA\')
               AND dr.estado_asiento IN (\'RESERVADO\', \'PAGADO\')
             LIMIT 1
             FOR UPDATE'
        );
        $occupied->execute(['flight_id' => $flightId, 'seat_id' => $seatId]);
        if ($occupied->fetch()) {
            $database->rollBack();
            respond(['error' => 'Ese asiento acaba de ser ocupado. Selecciona otro asiento.'], 409);
        }

        $passenger = $database->prepare(
            'SELECT id FROM pasajeros
             WHERE identificacion = :identificacion OR email = :email
             LIMIT 1'
        );
        $passenger->execute(['identificacion' => $identificacion, 'email' => $email]);
        $passengerRecord = $passenger->fetch();

        if ($passengerRecord) {
            $passengerId = (int) $passengerRecord['id'];
        } else {
            $insertPassenger = $database->prepare(
                'INSERT INTO pasajeros (identificacion, nombre, apellido, email, telefono)
                 VALUES (:identificacion, :nombre, :apellido, :email, :telefono)'
            );
            $insertPassenger->execute([
                'identificacion' => $identificacion,
                'nombre' => $nombre,
                'apellido' => $apellido,
                'email' => $email,
                'telefono' => $telefono
            ]);
            $passengerId = (int) $database->lastInsertId();
        }

        do {
            $code = 'RES-' . random_int(1000, 9999);
            $codeCheck = $database->prepare('SELECT id FROM reservas WHERE codigo_reserva = :code');
            $codeCheck->execute(['code' => $code]);
        } while ($codeCheck->fetch());

        $insertReservation = $database->prepare(
            'INSERT INTO reservas (codigo_reserva, pasajero_id, vuelo_id, estado)
             VALUES (:code, :passenger_id, :flight_id, \'PENDIENTE\')'
        );
        $insertReservation->execute([
            'code' => $code,
            'passenger_id' => $passengerId,
            'flight_id' => $flightId
        ]);
        $reservationId = (int) $database->lastInsertId();

        $insertDetail = $database->prepare(
            'INSERT INTO detalle_reserva (reserva_id, asiento_id, precio, estado_asiento)
             VALUES (:reservation_id, :seat_id, :precio, \'RESERVADO\')'
        );
        $insertDetail->execute([
            'reservation_id' => $reservationId,
            'seat_id' => $seatId,
            'precio' => $precio
        ]);

        $database->commit();
        respond([
            'message' => 'Reserva registrada correctamente.',
            'data' => ['codigo_reserva' => $code, 'pasajero_id' => $passengerId]
        ], 201);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'passengers') {
        $statement = $database->query(
            'SELECT p.id, p.identificacion, p.nombre, p.apellido, p.email, p.telefono,
                    COUNT(r.id) AS reservation_count
             FROM pasajeros p
             LEFT JOIN reservas r ON r.pasajero_id = p.id
               AND r.estado IN (\'PENDIENTE\', \'CONFIRMADA\')
             GROUP BY p.id, p.identificacion, p.nombre, p.apellido, p.email, p.telefono
             ORDER BY p.apellido, p.nombre'
        );
        respond(['data' => $statement->fetchAll()]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'reservations') {
        $statement = $database->query(
            'SELECT r.id, r.codigo_reserva, r.estado, r.fecha_reserva,
                    v.codigo_vuelo, v.fecha_salida,
                    a_orig.ciudad AS ciudad_origen,
                    a_dest.ciudad AS ciudad_destino,
                    p.id AS pasajero_id, p.identificacion, p.nombre, p.apellido,
                    p.email, p.telefono,
                    dr.precio, asi.numero_asiento
             FROM reservas r
             INNER JOIN pasajeros p ON p.id = r.pasajero_id
             INNER JOIN vuelos v ON v.id = r.vuelo_id
             INNER JOIN aeropuertos a_orig ON v.origen_id = a_orig.id
             INNER JOIN aeropuertos a_dest ON v.destino_id = a_dest.id
             LEFT JOIN detalle_reserva dr ON dr.reserva_id = r.id
             LEFT JOIN asientos asi ON asi.id = dr.asiento_id
             ORDER BY r.fecha_reserva DESC'
        );
        respond(['data' => $statement->fetchAll()]);
    }

    if ($_SERVER['REQUEST_METHOD'] === 'GET' && $action === 'summary') {
        $statement = $database->query(
            'SELECT
                (SELECT COUNT(*) FROM vuelos WHERE estado = \'PROGRAMADO\') AS scheduled_flights,
                (SELECT COUNT(*) FROM reservas WHERE estado IN (\'PENDIENTE\', \'CONFIRMADA\')) AS active_reservations,
                (SELECT COUNT(*) FROM pasajeros) AS registered_passengers'
        );
        respond(['data' => $statement->fetch()]);
    }

    respond(['error' => 'Acción no encontrada.'], 404);
} catch (PDOException $exception) {
    if (isset($database) && $database->inTransaction()) $database->rollBack();

    $message = 'No fue posible completar la operación.';
    $sqlState = (string) $exception->getCode();
    $driverCode = (int) ($exception->errorInfo[1] ?? 0);

    if ($driverCode === 1062) {
        $message = 'Ya existe un pasajero con esa identificación o correo electrónico.';
    } elseif ($driverCode === 1452) {
        $message = 'Los datos seleccionados no existen en la base de datos.';
    } elseif ($driverCode === 3819 || str_contains($exception->getMessage(), 'chk_')) {
        $message = 'Los datos no cumplen las restricciones de la base de datos.';
    }

    respond(['error' => $message, 'sqlstate' => $sqlState], 409);
} catch (Throwable $exception) {
    if (isset($database) && $database->inTransaction()) $database->rollBack();
    respond(['error' => 'Error interno del servidor.', 'detail' => $exception->getMessage()], 500);
}

function respond(array $payload, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
    exit;
}
