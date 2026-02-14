# IAM policy for Terraform admin (casey_aniruddh): create/manage ECR, ECS, ALB, security groups, IAM, CloudWatch
# Attached to the user that runs Terraform and deploy.sh so they can create load balancers and all casey infra.

data "aws_iam_user" "terraform_admin" {
  user_name = var.terraform_admin_iam_user_name
}

resource "aws_iam_policy" "terraform_admin" {
  name        = "${var.project_name}-terraform-admin"
  description = "Allows Terraform admin to create and manage ECR, ECS, ALB, security groups, IAM policies, and CloudWatch for casey backend"

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid      = "ECR"
        Effect   = "Allow"
        Action   = ["ecr:*"]
        Resource = "*"
      },
      {
        Sid      = "ECS"
        Effect   = "Allow"
        Action   = ["ecs:*"]
        Resource = "*"
      },
      {
        Sid      = "LoadBalancing"
        Effect   = "Allow"
        Action   = ["elasticloadbalancing:*"]
        Resource = "*"
      },
      {
        Sid    = "EC2SecurityGroupsAndNetwork"
        Effect = "Allow"
        Action = [
          "ec2:CreateSecurityGroup",
          "ec2:DeleteSecurityGroup",
          "ec2:DescribeSecurityGroups",
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:AuthorizeSecurityGroupEgress",
          "ec2:RevokeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupEgress",
          "ec2:DescribeVpcs",
          "ec2:DescribeSubnets",
          "ec2:DescribeNetworkInterfaces",
          "ec2:CreateTags",
          "ec2:DeleteTags",
          "ec2:DescribeTags"
        ]
        Resource = "*"
      },
      {
        Sid    = "IAMPolicyRoleAndAttach"
        Effect = "Allow"
        Action = [
          "iam:CreatePolicy",
          "iam:GetPolicy",
          "iam:GetPolicyVersion",
          "iam:DeletePolicy",
          "iam:CreatePolicyVersion",
          "iam:DeletePolicyVersion",
          "iam:ListPolicyVersions",
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:GetRole",
          "iam:PassRole",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:ListAttachedRolePolicies",
          "iam:PutRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:GetRolePolicy",
          "iam:ListRolePolicies",
          "iam:AttachUserPolicy",
          "iam:DetachUserPolicy",
          "iam:ListAttachedUserPolicies",
          "iam:ListUserPolicies",
          "iam:GetUser"
        ]
        Resource = "*"
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:DeleteLogGroup",
          "logs:DescribeLogGroups",
          "logs:PutRetentionPolicy",
          "logs:TagLogGroup",
          "logs:UntagLogGroup"
        ]
        Resource = "*"
      },
      {
        Sid      = "ApplicationAutoscaling"
        Effect   = "Allow"
        Action   = ["application-autoscaling:*"]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_user_policy_attachment" "terraform_admin" {
  user       = data.aws_iam_user.terraform_admin.user_name
  policy_arn = aws_iam_policy.terraform_admin.arn
}
