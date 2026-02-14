locals {
  use_https          = trimspace(var.alb_certificate_arn) != ""
  service_name       = "${var.project_name}-backend"
  ecr_repository     = "${var.project_name}-backend"
  ecs_log_group_name = "/ecs/${var.project_name}-backend"
}

data "aws_vpc" "default" {
  count   = var.vpc_id == "" ? 1 : 0
  default = true
}

locals {
  selected_vpc_id = var.vpc_id != "" ? var.vpc_id : data.aws_vpc.default[0].id
}

data "aws_subnets" "selected" {
  count = length(var.subnet_ids) == 0 ? 1 : 0

  filter {
    name   = "vpc-id"
    values = [local.selected_vpc_id]
  }
}

locals {
  selected_subnet_ids = length(var.subnet_ids) > 0 ? var.subnet_ids : data.aws_subnets.selected[0].ids
}

resource "aws_ecr_repository" "backend" {
  name                 = local.ecr_repository
  image_tag_mutability = "MUTABLE"

  image_scanning_configuration {
    scan_on_push = true
  }

  tags = {
    Name        = local.ecr_repository
    Environment = var.environment
    Service     = local.service_name
  }
}

resource "aws_ecr_lifecycle_policy" "backend" {
  repository = aws_ecr_repository.backend.name

  policy = jsonencode({
    rules = [
      {
        rulePriority = 1
        description  = "Retain only recent images"
        selection = {
          tagStatus   = "any"
          countType   = "imageCountMoreThan"
          countNumber = 20
        }
        action = {
          type = "expire"
        }
      }
    ]
  })
}

resource "aws_cloudwatch_log_group" "casey_backend_ecs" {
  name              = local.ecs_log_group_name
  retention_in_days = 30

  tags = {
    Name        = local.ecs_log_group_name
    Environment = var.environment
    Service     = local.service_name
  }
}

resource "aws_security_group" "alb" {
  count       = var.enable_alb ? 1 : 0
  name        = "${var.project_name}-alb-sg"
  description = "ALB security group for backend"
  vpc_id      = local.selected_vpc_id

  ingress {
    description = "Allow HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = var.alb_allowed_cidrs
  }

  dynamic "ingress" {
    for_each = local.use_https ? [1] : []
    content {
      description = "Allow HTTPS"
      from_port   = 443
      to_port     = 443
      protocol    = "tcp"
      cidr_blocks = var.alb_allowed_cidrs
    }
  }

  egress {
    description = "Allow all outbound"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project_name}-alb-sg"
    Environment = var.environment
    Service     = local.service_name
  }

  lifecycle {
    # Ensure ECS security group updates before ALB security group is destroyed
    # This prevents DependencyViolation when switching from enable_alb=true to false
    create_before_destroy = false
  }
}

resource "aws_security_group" "ecs" {
  name        = "${var.project_name}-ecs-sg"
  description = "ECS task security group for backend"
  vpc_id      = local.selected_vpc_id

  dynamic "ingress" {
    for_each = var.enable_alb ? [1] : []
    content {
      description     = "Allow ALB to ECS backend traffic"
      from_port       = var.backend_container_port
      to_port         = var.backend_container_port
      protocol        = "tcp"
      security_groups = [aws_security_group.alb[0].id]
    }
  }

  dynamic "ingress" {
    for_each = var.enable_alb ? [] : [1]
    content {
      description = "Allow direct access to backend when ALB is disabled"
      from_port   = var.backend_container_port
      to_port     = var.backend_container_port
      protocol    = "tcp"
      cidr_blocks = ["0.0.0.0/0"]
    }
  }

  egress {
    description = "Allow all outbound (AWS APIs)"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = {
    Name        = "${var.project_name}-ecs-sg"
    Environment = var.environment
    Service     = local.service_name
  }
}

resource "aws_lb" "backend" {
  count              = var.enable_alb ? 1 : 0
  name               = "${var.project_name}-backend-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb[0].id]
  subnets            = local.selected_subnet_ids

  tags = {
    Name        = "${var.project_name}-backend-alb"
    Environment = var.environment
    Service     = local.service_name
  }
}

resource "aws_lb_target_group" "backend" {
  count       = var.enable_alb ? 1 : 0
  name        = "${var.project_name}-backend-tg"
  port        = var.backend_container_port
  protocol    = "HTTP"
  target_type = "ip"
  vpc_id      = local.selected_vpc_id

  health_check {
    enabled             = true
    path                = var.backend_healthcheck_path
    protocol            = "HTTP"
    matcher             = "200-499"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    interval            = 30
    timeout             = 5
  }

  stickiness {
    enabled         = true
    type            = "lb_cookie"
    cookie_duration = 86400
  }

  tags = {
    Name        = "${var.project_name}-backend-tg"
    Environment = var.environment
    Service     = local.service_name
  }
}

resource "aws_lb_listener" "http_redirect" {
  count             = var.enable_alb && local.use_https ? 1 : 0
  load_balancer_arn = aws_lb.backend[0].arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type = "redirect"

    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "http" {
  count             = var.enable_alb && !local.use_https ? 1 : 0
  load_balancer_arn = aws_lb.backend[0].arn
  port              = 80
  protocol          = "HTTP"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend[0].arn
  }
}

resource "aws_lb_listener" "https" {
  count             = var.enable_alb && local.use_https ? 1 : 0
  load_balancer_arn = aws_lb.backend[0].arn
  port              = 443
  protocol          = "HTTPS"
  ssl_policy        = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn   = var.alb_certificate_arn

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend[0].arn
  }
}

resource "aws_ecs_cluster" "backend" {
  name = "${var.project_name}-cluster"

  tags = {
    Name        = "${var.project_name}-cluster"
    Environment = var.environment
    Service     = local.service_name
  }
}

data "aws_iam_policy_document" "ecs_task_assume_role" {
  statement {
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["ecs-tasks.amazonaws.com"]
    }

    actions = ["sts:AssumeRole"]
  }
}

resource "aws_iam_role" "ecs_task_execution_role" {
  name               = "${var.project_name}-ecs-task-execution-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_execution_role_policy" {
  role       = aws_iam_role.ecs_task_execution_role.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role" "ecs_task_role" {
  name               = "${var.project_name}-ecs-task-role"
  assume_role_policy = data.aws_iam_policy_document.ecs_task_assume_role.json
}

resource "aws_iam_role_policy_attachment" "ecs_task_casey_backend_policy" {
  role       = aws_iam_role.ecs_task_role.name
  policy_arn = aws_iam_policy.casey_backend.arn
}

locals {
  resolved_backend_image = trimspace(var.backend_container_image) != "" ? var.backend_container_image : "${aws_ecr_repository.backend.repository_url}:latest"
}

resource "aws_ecs_task_definition" "backend" {
  family                   = "${var.project_name}-backend"
  requires_compatibilities = ["FARGATE"]
  network_mode             = "awsvpc"
  cpu                      = tostring(var.ecs_task_cpu)
  memory                   = tostring(var.ecs_task_memory)
  execution_role_arn       = aws_iam_role.ecs_task_execution_role.arn
  task_role_arn            = aws_iam_role.ecs_task_role.arn

  container_definitions = jsonencode([
    {
      name      = local.service_name
      image     = local.resolved_backend_image
      essential = true
      portMappings = [
        {
          containerPort = var.backend_container_port
          hostPort      = var.backend_container_port
          protocol      = "tcp"
        }
      ]
      environment = [
        {
          name  = "NODE_ENV"
          value = "production"
        },
        {
          name  = "PORT"
          value = tostring(var.backend_container_port)
        },
        {
          name  = "AWS_REGION"
          value = var.aws_region
        }
      ]
      logConfiguration = {
        logDriver = "awslogs"
        options = {
          awslogs-group         = aws_cloudwatch_log_group.casey_backend_ecs.name
          awslogs-region        = var.aws_region
          awslogs-stream-prefix = local.service_name
        }
      }
    }
  ])

  depends_on = [
    aws_iam_role_policy_attachment.ecs_task_execution_role_policy,
    aws_iam_role_policy_attachment.ecs_task_casey_backend_policy
  ]
}

resource "aws_ecs_service" "backend" {
  name            = local.service_name
  cluster         = aws_ecs_cluster.backend.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count   = var.ecs_service_desired_count
  launch_type     = "FARGATE"

  network_configuration {
    subnets          = local.selected_subnet_ids
    security_groups  = [aws_security_group.ecs.id]
    assign_public_ip = var.ecs_assign_public_ip
  }

  dynamic "load_balancer" {
    for_each = var.enable_alb ? [1] : []
    content {
      target_group_arn = aws_lb_target_group.backend[0].arn
      container_name   = local.service_name
      container_port   = var.backend_container_port
    }
  }

  deployment_minimum_healthy_percent = 50
  deployment_maximum_percent         = 200
}

resource "aws_appautoscaling_target" "ecs_service" {
  count              = var.enable_autoscaling ? 1 : 0
  max_capacity       = var.autoscaling_max_capacity
  min_capacity       = var.autoscaling_min_capacity
  resource_id        = "service/${aws_ecs_cluster.backend.name}/${aws_ecs_service.backend.name}"
  scalable_dimension = "ecs:service:DesiredCount"
  service_namespace  = "ecs"
}

resource "aws_appautoscaling_policy" "ecs_cpu_target" {
  count              = var.enable_autoscaling ? 1 : 0
  name               = "${var.project_name}-ecs-cpu-target"
  policy_type        = "TargetTrackingScaling"
  resource_id        = aws_appautoscaling_target.ecs_service[0].resource_id
  scalable_dimension = aws_appautoscaling_target.ecs_service[0].scalable_dimension
  service_namespace  = aws_appautoscaling_target.ecs_service[0].service_namespace

  target_tracking_scaling_policy_configuration {
    predefined_metric_specification {
      predefined_metric_type = "ECSServiceAverageCPUUtilization"
    }
    target_value       = var.autoscaling_cpu_target
    scale_in_cooldown  = 60
    scale_out_cooldown = 60
  }
}
